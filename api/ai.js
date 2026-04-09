module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const secret = process.env.APP_SECRET || 'default-secret';
    if (token !== secret) return res.status(401).json({ error: 'Unauthorized' });

    const { action, data } = req.body || {};
    if (!action) return res.status(400).json({ error: 'Missing action' });

    if (action === 'test') {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
          try {
                  const r = await fetch('https://api.anthropic.com/v1/messages', {
                            method: 'POST',
                            headers: {
                                        'Content-Type': 'application/json',
                                        'x-api-key': apiKey,
                                        'anthropic-version': '2023-06-01'
                            },
                            body: JSON.stringify({
                                        model: 'claude-haiku-4-5-20251001',
                                        max_tokens: 10,
                                        messages: [{ role: 'user', content: 'Hi' }]
                            })
                  });
                  const d = await r.json();
                  if (d.error) return res.status(500).json({ error: d.error.message });
                  return res.json({ ok: true, provider: 'anthropic', message: 'Соединение установлено!' });
          } catch (e) {
                  return res.status(500).json({ error: e.message });
          }
    }

    let prompt = '';
    let isMultimodal = false;
    let fileData = null;

    switch (action) {
      case 'smart_import':
              prompt = `Extract contacts from the following text. Return ONLY valid JSON array with objects containing fields: name, position, company, phone, email, telegram, source. If a field is unknown, use empty string. Text:\n\n${data.text}`;
              break;
      case 'file_import':
              prompt = `Extract all candidate/contact information from this file. Return ONLY valid JSON array with objects containing: name, position, company, phone, email, telegram, source, notes. If a field is unknown use empty string.`;
              if (data.fileContent) {
                        if (data.mimeType && data.mimeType.startsWith('image/')) {
                                    isMultimodal = true;
                                    fileData = { mime: data.mimeType, base64: data.fileContent };
                        } else {
                                    prompt += `\n\nFile content:\n${data.fileContent}`;
                        }
              }
              break;
      case 'enrich_candidate':
              prompt = `Based on this candidate info, suggest improvements and additional details. Return JSON with fields: suggestedPosition, suggestedSkills (array), summary, interviewQuestions (array of 5). Candidate: ${JSON.stringify(data.candidate)}`;
              break;
      case 'match_vacancy':
              prompt = `Score how well this candidate matches this vacancy. Return JSON with: score (0-100), pros (array), cons (array), recommendation (string). Candidate: ${JSON.stringify(data.candidate)}. Vacancy: ${JSON.stringify(data.vacancy)}`;
              break;
      case 'generate_vacancy':
              prompt = `Generate a professional job vacancy description in Russian. Return JSON with: title, department, requirements (array), responsibilities (array), conditions (array), description. Input: ${JSON.stringify(data)}`;
              break;
      case 'pipeline_insights':
              prompt = `Analyze this recruitment pipeline data and provide insights. Return JSON with: summary (string in Russian), bottlenecks (array of strings), recommendations (array of strings), metrics (object with avgTimeToHire, conversionRate, topSources). Data:\n${JSON.stringify(data.stats)}`;
              break;
      default:
              return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    try {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          const messages = [];
          const content = [];
          if (isMultimodal && fileData) {
                  content.push({ type: 'image', source: { type: 'base64', media_type: fileData.mime, data: fileData.base64 } });
          }
          content.push({ type: 'text', text: prompt });
          messages.push({ role: 'user', content });

      const r = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01'
              },
              body: JSON.stringify({
                        model: 'claude-haiku-4-5-20251001',
                        max_tokens: 4096,
                        messages
              })
      });
          const d = await r.json();
          if (d.error) return res.status(500).json({ error: d.error.message });
          const result = d.content[0].text;
          return res.json({ ok: true, result });
    } catch (e) {
          return res.status(500).json({ error: e.message || 'AI request failed' });
    }
};
