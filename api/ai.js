const https = require('https');
// Lazy-loaded docx parser (available on server as fallback)
let _mammoth = null;
function getMammoth(){
  if (_mammoth) return _mammoth;
  try { _mammoth = require('mammoth'); } catch (e) { _mammoth = false; }
  return _mammoth;
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Auth
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const secret = process.env.APP_SECRET || 'default-secret';
  if (token !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const { action, data } = req.body || {};
  if (!action) return res.status(400).json({ error: 'Missing action' });

  // Test endpoint
  if (action === 'test') {
    return res.json({ ok: true, provider: getProvider(), message: 'Соединение установлено!' });
  }

  // Build prompt based on action
  let prompt = '';
  let isMultimodal = false;
  let fileData = null;

  switch (action) {
    case 'smart_import':
      prompt = `Extract contacts from the following text. Return ONLY valid JSON array with objects containing fields: name, position, company, phone, email, telegram, source. If a field is unknown, use empty string. Text:\n\n${data.text}`;
      break;

    case 'file_import': {
      const fileName = data.filename || data.fileName || 'file';
      const fileType = (data.filetype || data.mimeType || '').toLowerCase();
      const kindHint = (data.kind || '').toLowerCase();
      const preText = typeof data.text === 'string' ? data.text : '';
      let rawData = data.filedata || data.fileContent || '';
      // Strip data URL prefix: "data:application/pdf;base64,XXXX"
      let detectedMime = fileType;
      let base64 = rawData;
      const m = typeof rawData === 'string' ? rawData.match(/^data:([^;]+);base64,(.+)$/) : null;
      if (m) {
        if (!detectedMime) detectedMime = m[1].toLowerCase();
        base64 = m[2];
      }

      prompt = `You are extracting candidate/contact data from a resume or contact file. Return ONLY a valid JSON array (no prose, no markdown) with one object per person. Each object MUST have these fields: name, position, company, phone, email, telegram, source, notes. The "name" field MUST contain the full name of the person exactly as written in the document — never leave it empty if any name is present. Use empty string "" only for truly unknown fields. File name: ${fileName}`;

      // 1) If client pre-extracted text (PDF/DOCX/TXT/CSV/VCF) — send as text, no file attachment
      if (preText && preText.trim().length > 0) {
        prompt += `\n\nFile content (extracted text):\n${preText.slice(0, 120000)}`;
      } else if (base64) {
        // 2) Native multimodal for images and PDFs
        if ((detectedMime && detectedMime.startsWith('image/')) || kindHint === 'image') {
          isMultimodal = true;
          fileData = { kind: 'image', mime: detectedMime || 'image/jpeg', base64 };
        } else if (detectedMime === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf') || kindHint === 'pdf') {
          isMultimodal = true;
          fileData = { kind: 'document', mime: 'application/pdf', base64 };
        } else if (kindHint === 'docx' || kindHint === 'doc' || fileName.toLowerCase().endsWith('.docx') || fileName.toLowerCase().endsWith('.doc') || detectedMime === 'application/msword' || detectedMime.indexOf('officedocument.wordprocessingml') >= 0) {
          // Word document — use mammoth on server
          const mammoth = getMammoth();
          if (mammoth) {
            try {
              const buf = Buffer.from(base64, 'base64');
              const r = await mammoth.extractRawText({ buffer: buf });
              const text = (r && r.value ? r.value : '').trim();
              if (text.length > 10) {
                prompt += `\n\nFile content (extracted from Word document):\n${text.slice(0, 120000)}`;
              } else {
                prompt += `\n\n(Word document had no extractable text.)`;
              }
            } catch (err) {
              prompt += `\n\n(Failed to parse Word document: ${err.message}.)`;
            }
          } else {
            prompt += `\n\n(Word parser not available on server — install mammoth.)`;
          }
        } else {
          // Fallback: decode base64 → utf-8 text
          try {
            const text = Buffer.from(base64, 'base64').toString('utf-8');
            prompt += `\n\nFile content:\n${text.slice(0, 80000)}`;
          } catch (err) {
            prompt += `\n\n(Unsupported binary file type: ${detectedMime}.)`;
          }
        }
      }
      break;
    }

    case 'assess_candidate':
      prompt = `You are an expert HR consultant. Assess this candidate for recruitment. Return JSON with: score (1-100), strengths (array of strings), weaknesses (array of strings), recommendation (string), interviewQuestions (array of 5 strings). Candidate data:\n${JSON.stringify(data.candidate)}`;
      break;

    case 'compose_message':
      prompt = `Write a professional recruitment outreach message in Russian for this candidate. Return JSON with: email (object with subject and body), telegram (string - short message). Candidate:\n${JSON.stringify(data.candidate)}\nVacancy: ${data.vacancy || 'general recruitment'}`;
      break;

    case 'find_duplicates':
      prompt = `Analyze this list of candidates and find potential duplicates (same person with slightly different data). Return JSON array of arrays, where each inner array contains indices of duplicate candidates. Candidates:\n${JSON.stringify(data.candidates)}`;
      break;

    case 'pipeline_insights':
      prompt = `Analyze this recruitment pipeline data and provide insights. Return JSON with: summary (string in Russian), bottlenecks (array of strings), recommendations (array of strings), metrics (object with avgTimeToHire, conversionRate, topSources). Data:\n${JSON.stringify(data.stats)}`;
      break;

    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  try {
    const result = await callAI(prompt, isMultimodal, fileData);
    return res.json({ ok: true, result });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'AI request failed' });
  }
};

function getProvider() {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'none';
}

async function callAI(prompt, isMultimodal, fileData) {
  const provider = getProvider();
  if (provider === 'none') throw new Error('No AI API key configured');

  switch (provider) {
    case 'anthropic': return callAnthropic(prompt, isMultimodal, fileData);
    case 'openai': return callOpenAI(prompt, isMultimodal, fileData);
    case 'gemini': return callGemini(prompt, isMultimodal, fileData);
  }
}

function callAnthropic(prompt, isMultimodal, fileData) {
  const content = [];
  if (isMultimodal && fileData) {
    if (fileData.kind === 'document') {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: fileData.mime, data: fileData.base64 }
      });
    } else {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: fileData.mime, data: fileData.base64 }
      });
    }
  }
  content.push({ type: 'text', text: prompt });

  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content }]
  });

  return httpPost('api.anthropic.com', '/v1/messages', {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01'
  }, body).then(r => {
    const j = JSON.parse(r);
    if (j.error) throw new Error(j.error.message);
    const text = j.content?.[0]?.text || '';
    return parseJSON(text);
  });
}

function callOpenAI(prompt, isMultimodal, fileData) {
  const messages = [];
  if (isMultimodal && fileData) {
    messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${fileData.mime};base64,${fileData.base64}` } },
        { type: 'text', text: prompt }
      ]
    });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  const body = JSON.stringify({
    model: isMultimodal ? 'gpt-4o-mini' : 'gpt-4o-mini',
    max_tokens: 4096,
    messages
  });

  return httpPost('api.openai.com', '/v1/chat/completions', {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
  }, body).then(r => {
    const j = JSON.parse(r);
    if (j.error) throw new Error(j.error.message);
    const text = j.choices?.[0]?.message?.content || '';
    return parseJSON(text);
  });
}

function callGemini(prompt, isMultimodal, fileData) {
  const parts = [];
  if (isMultimodal && fileData) {
    parts.push({ inline_data: { mime_type: fileData.mime, data: fileData.base64 } });
  }
  parts.push({ text: prompt });

  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { maxOutputTokens: 4096 }
  });

  const key = process.env.GEMINI_API_KEY;
  return httpPost('generativelanguage.googleapis.com', `/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
    'Content-Type': 'application/json'
  }, body).then(r => {
    const j = JSON.parse(r);
    if (j.error) throw new Error(j.error.message);
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return parseJSON(text);
  });
}

function parseJSON(text) {
  // Try to extract JSON from the response
  let clean = text.trim();
  // Remove markdown code blocks
  clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(clean);
  } catch {
    // Try to find JSON in the text
    const match = clean.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return { raw: text };
  }
}

function httpPost(host, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
