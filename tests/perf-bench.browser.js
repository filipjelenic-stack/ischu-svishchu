// Performance benchmark — runs IN THE BROWSER, not Node (it measures real DOM work).
//
// НИКОГДА не запускать на https://ischu-svishchu.vercel.app — это боевая база Юлии.
// Только localhost или Vercel preview URL.
//
// How to run:
//   1. Serve the repo locally:  npx serve -p 3001 .
//   2. Open http://localhost:3001, open DevTools console.
//   3. Paste this whole file, press Enter. Takes ~10 seconds.
//   4. It seeds 7,500 synthetic candidates, measures, PRINTS A TABLE, then removes them.
//
// Baseline recorded 2026-07-30 (desktop Chrome; iPhone Safari is ~3-5x slower):
//   loadData 144ms · renderAll 189ms (67,551 DOM nodes) · searchHot 65ms
//   searchNarrow 6ms · saveData 3293ms · single put 1.2ms · render 200 cards 2ms

(async () => {
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'
      && !/-.*\.vercel\.app$/.test(location.hostname)) {
    console.error('ОТКАЗ: это не localhost и не preview. На проде бенчмарк запускать нельзя.');
    return;
  }
  const N = 7500;
  const FIRST=['Иван','Мария','Алексей','Ольга','Дмитрий','Елена','Сергей','Анна','Павел','Татьяна'];
  const LAST=['Иванов','Петров','Сидоров','Смирнов','Кузнецов','Попов','Васильев','Соколов','Михайлов','Новиков'];
  const POS=['Бухгалтер','Финансовый директор','Аналитик','Менеджер по продажам','HR-менеджер','Разработчик','Юрист','Маркетолог','Офис-менеджер','Логист'];
  const STAT=['new','contacted','interview','offer','hired','rejected'];
  const cands=[];
  for(let i=0;i<N;i++){
    cands.push({
      id:'perfbench_'+i, name:LAST[(i*7)%10]+' '+FIRST[i%10], position:POS[i%10],
      company:'Компания '+(i%50), status:STAT[i%6], source:'other', vacancy:'', rating:3,
      salaryMin:50000+(i%20)*10000, salaryMax:80000+(i%20)*12000, interviewDate:'', nextAction:'',
      phones:[{type:'mobile',value:'+7 (9'+(10+i%90)+') '+(100+i%900)+'-'+(10+i%90)+'-'+(10+(i*3)%90)}],
      emails:[{type:'work',value:'bench'+i+'@example.com'}], socials:[],
      photo:null, notes:'Синтетика для бенчмарка', files:[], created:'2026-07-01',
      activityLog:[]
    });
  }
  const R={};
  let t0=performance.now(); await db.candidates.bulkAdd(cands); R['bulkAdd 7500']=performance.now()-t0;
  t0=performance.now(); await loadData(); R['loadData (7.5k+)']=performance.now()-t0;
  t0=performance.now(); renderCandidates(); R['renderAll']=performance.now()-t0;
  R['DOM nodes']=document.getElementById('screen-1').querySelectorAll('*').length;
  candSearch='иванов'; t0=performance.now(); renderCandidates(); R['search cold']=performance.now()-t0;
  candSearch='петров'; t0=performance.now(); renderCandidates(); R['search hot']=performance.now()-t0;
  candSearch='bench4444@example.com'; t0=performance.now(); renderCandidates(); R['search narrow']=performance.now()-t0;
  candSearch=''; t0=performance.now(); await saveData(); R['saveData full']=performance.now()-t0;
  t0=performance.now(); await db.candidates.put(JSON.parse(JSON.stringify(candidates[100]))); R['single put']=performance.now()-t0;
  // cleanup
  await db.candidates.where('id').startsWith('perfbench_').delete();
  await loadData(); renderCandidates();
  console.table(Object.fromEntries(Object.entries(R).map(([k,v])=>[k, typeof v==='number'&&k!=='DOM nodes'?Math.round(v*10)/10+' ms':v])));
})();
