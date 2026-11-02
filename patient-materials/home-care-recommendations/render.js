const { chromium } = require('playwright');
(async () => {
  const dir = '/home/user/TFA/patient-materials/home-care-recommendations';
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:816,height:1056}, deviceScaleFactor:1.5});
  await p.goto('file://' + dir + '/home-care-recommendations.html'); await p.waitForTimeout(500);
  const of = await p.$$eval('.page', ps => ps.map((pg,i)=>{const b=pg.querySelector('.body'); if(!b) return [i+1,'cover']; const last=[...b.children].pop(); return [i+1, Math.round(b.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom)];}));
  console.log('space left (px) per page:', JSON.stringify(of));
  const pages = await p.$$('.page'); for (let i=0;i<pages.length;i++) await pages[i].screenshot({path:`/tmp/hc-p${i+1}.png`});
  await p.pdf({path: dir + '/Total-Fuze-Home-Care-Recommendations.pdf', preferCSSPageSize:true, printBackground:true});
  await b.close();
})();
