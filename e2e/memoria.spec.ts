import {expect,test,type Page} from '@playwright/test';
async function rows(page:Page,table:string){return page.evaluate(table=>new Promise<unknown[]>((resolve,reject)=>{const request=indexedDB.open('nocturne');request.onsuccess=()=>{const db=request.result,tx=db.transaction(table),r=tx.objectStore(table).getAll();r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);};request.onerror=()=>reject(request.error);}),table);}
async function deck(page:Page){
  await page.goto('/#/memoria/decks');await page.getByRole('button',{name:'新建卡组',exact:true}).click();
  await page.getByLabel('卡组名称',{exact:true}).fill('AI 工程');await page.getByRole('button',{name:'保存卡组',exact:true}).click();
  await expect(page.getByRole('heading',{name:'AI 工程',exact:true})).toBeVisible();
}
async function basic(page:Page,front='梯度是什么？',back='函数变化最快的方向。'){
  await page.goto('/#/memoria/studio');await page.getByLabel('卡片问题',{exact:true}).fill(front);await page.getByLabel('卡片答案',{exact:true}).fill(back);await page.getByRole('button',{name:'保存卡片笔记',exact:true}).click();await expect(page.getByRole('button',{name:'已保存',exact:true})).toBeVisible();
}
test('formal keyboard review, undo, reload and edited cards preserve memory',async({page},info)=>{
  await page.emulateMedia({reducedMotion:'reduce'});await deck(page);await basic(page);await page.goto('/#/memoria');
  await page.getByRole('button',{name:'开始主动回忆',exact:true}).click();await expect(page.locator('.recall-card')).toContainText('梯度是什么');
  await page.keyboard.press('3');expect((await rows(page,'reviewLogs')).length).toBe(0);
  await page.keyboard.press('Space');await expect(page.locator('.revealed-answer')).toContainText('函数变化');
  await page.screenshot({path:info.outputPath('memoria-recall-desktop.png'),fullPage:true});await page.keyboard.press('4');
  await expect(page.getByRole('heading',{name:'这一轮，已留下痕迹。'})).toBeVisible();
  await page.keyboard.press('Control+z');await expect(page.getByRole('button',{name:'揭晓答案'})).toBeVisible();await page.reload();
  await expect(page.locator('.recall-card')).toContainText('梯度是什么');await page.keyboard.press('Space');await expect(page.locator('.rating-3')).toBeEnabled();await page.keyboard.press('4');
  await expect(page.getByRole('heading',{name:'这一轮，已留下痕迹。'})).toBeVisible();
  const before=(await rows(page,'cards')) as {memory:{reps:number;due:string}}[];expect(before[0].memory.reps).toBe(1);
  await page.goto('/#/memoria/browser');await page.getByRole('link',{name:'编辑',exact:true}).click();await page.getByLabel('卡片问题').fill('用自己的话解释梯度。');await page.getByRole('button',{name:'保存卡片笔记',exact:true}).click();await expect(page.getByRole('button',{name:'已保存',exact:true})).toBeVisible();
  const after=(await rows(page,'cards')) as {memory:unknown}[];expect(after[0].memory).toEqual(before[0].memory);
});
test('all note templates and local image occlusion work on mobile',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await deck(page);
  for(const [type,question,answer]of [['basic','Q','A'],['bidirectional','hello','你好'],['cloze','梯度是 {{c1::方向}}，步长是 {{c2::学习率}}',''],['concept','什么是过拟合？','训练集好、泛化差。'],['code','下面输出什么？','~~~python\nprint(1+1)\n~~~']]){
    await page.goto('/#/memoria/studio');await page.getByRole('combobox',{name:'模板',exact:true}).selectOption(type);await page.getByLabel('卡片问题',{exact:true}).fill(question);if(answer)await page.getByLabel('卡片答案',{exact:true}).fill(answer);
    await page.getByRole('button',{name:'保存卡片笔记',exact:true}).click();await expect(page.getByRole('button',{name:'已保存',exact:true})).toBeVisible();await page.getByRole('button',{name:'继续制作下一张'}).click();
  }
  await page.goto('/#/memoria/studio');await page.getByRole('combobox',{name:'模板',exact:true}).selectOption('image');await page.getByLabel('遮挡图片').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKIoAAAAASUVORK5CYII=','base64')});await expect(page.locator('.occlusion-canvas img')).toBeVisible();
  await page.getByRole('button',{name:'添加遮挡区域'}).click();await page.getByRole('button',{name:'保存卡片笔记',exact:true}).click();await expect(page.getByRole('button',{name:'已保存',exact:true})).toBeVisible();
  expect((await rows(page,'notes')).length).toBe(6);expect((await rows(page,'cards')).length).toBe(8);
  await page.goto('/#/memoria');await expect(page.getByRole('heading',{name:'让知识，成为你的一部分。'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);await page.screenshot({path:info.outputPath('memoria-mobile.png'),fullPage:true});
});
test('knowledge autosave, Markdown cards, versions and local rich images survive reload',async({page})=>{
  await page.goto('/#/memoria/vault');await page.getByRole('button',{name:'新建知识',exact:true}).click();await page.getByLabel('知识标题').fill('线性代数');await page.getByLabel('知识正文').fill('## 基础\n\n秩 >> 独立信息的数量\n\n$W^T x$');
  await page.getByRole('button',{name:/同步卡片/}).click();await expect(page.locator('.save-status')).toHaveText('已保存');await page.reload();await expect(page.getByLabel('知识正文')).toHaveValue(/独立信息/);
  await page.getByLabel('知识正文').fill('## 基础\n\n秩 >> 主元的数量\n\n$W^T x$');await page.getByRole('button',{name:'保存知识',exact:true}).click();await expect(page.locator('.save-status')).toHaveText('已保存');
  await page.getByRole('button',{name:'阅读预览'}).click();await expect(page.locator('.rich .katex')).toBeVisible();await expect(page.locator('.rich')).toContainText('主元的数量');
  expect((await rows(page,'cards')).length).toBe(1);await page.getByRole('button',{name:/版本历史/}).click();await expect(page.getByRole('heading',{name:'所选版本'})).toBeVisible();
});
test('CSV import deduplicates and full ZIP is downloadable',async({page})=>{
  await deck(page);await page.goto('/#/memoria/exchange');await page.getByRole('combobox',{name:'目标卡组',exact:true}).selectOption({label:'AI 工程'});
  await page.getByLabel('导入内容').fill('front,back\n"Q,1","A\nline"\n"Q,1","A\nline"');
  await page.getByRole('button',{name:'验证并导入'}).click();await expect(page.getByRole('status').filter({hasText:'新增 1 条'})).toBeVisible();
  await page.getByRole('button',{name:'验证并导入'}).click();await expect(page.getByRole('status').filter({hasText:'新增 0 条'})).toBeVisible();
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'完整 ZIP（含附件）'}).click();expect((await event).suggestedFilename()).toBe('NOCTURNE-V3.zip');
});
test('MEMORIA lazy route opens offline before first visit',async({context,page})=>{
  await page.goto('/');await expect(page.getByRole('heading',{name:'Make today count.'})).toBeVisible();await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);await page.goto('/#/memoria/vault');await expect(page.getByText('把理解写成自己的话',{exact:true})).toBeVisible();
});
test('10k cards and 100k logs stay responsive in real IndexedDB',async({page},info)=>{
  test.setTimeout(120000);await deck(page);
  await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('nocturne');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const deck=await new Promise<{id:string}>((resolve)=>{const r=db.transaction('decks').objectStore('decks').getAll();r.onsuccess=()=>resolve(r.result[0]);}),now=new Date().toISOString();
    const stamp={createdAt:now,updatedAt:now,revision:0},memory={due:now,stability:5,difficulty:5,elapsed_days:2,scheduled_days:5,learning_steps:0,reps:2,lapses:0,state:2,last_review:now};
    for(let start=0;start<100000;start+=1000){
      await new Promise<void>((resolve,reject)=>{const tx=db.transaction(start<10000?['notes','cards','reviewLogs','studySessions']:['reviewLogs'],'readwrite');
        if(start===0)tx.objectStore('studySessions').put({...stamp,id:'perf-session',mode:'daily',queue:[],revealed:false,status:'done',shownAt:now,limitMinutes:15});
        for(let i=start;i<start+1000;i++){
          const c=i%10000;if(start<10000){tx.objectStore('notes').put({...stamp,id:'n-'+i,deckId:deck.id,type:'basic',front:'性能问题 '+i,back:'答案 '+i,extra:'',hint:'',source:'',regions:[],tags:[],archived:false,trashed:false,favorite:false});tx.objectStore('cards').put({...stamp,id:'c-'+i,noteId:'n-'+i,deckId:deck.id,templateKey:'forward',front:'性能问题 '+i,back:'答案 '+i,memory,eligible:1,suspended:false,archived:false,trashed:false});}
          tx.objectStore('reviewLogs').put({id:'l-'+i,cardId:'c-'+c,sessionId:'perf-session',rating:3,reviewedAt:now,duration:2000,formal:true,dueReview:true,before:memory,after:memory,revision:2,undone:false,updatedAt:now,algorithm:'ts-fsrs@5.4.2',parameters:{},queueBefore:[]});
        }tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
    }db.close();
  });
  const start=Date.now();await page.goto('/#/memoria/browser');await expect(page.getByText('已选 0 · 共 10000 张')).toBeVisible({timeout:15000});const browser=Date.now()-start;
  await page.getByLabel('搜索卡片').fill('性能问题 9999');await expect(page.getByText('已选 0 · 共 1 张',{exact:true})).toBeVisible();const search=Date.now()-start-browser;
  const a=Date.now();await page.goto('/#/memoria/analytics');await expect(page.locator('.memory-metrics dd').first()).toHaveText('100000',{timeout:20000});const analytics=Date.now()-a;
  await info.attach('memoria-performance.json',{body:JSON.stringify({cards:10000,logs:100000,browserMs:browser,searchMs:search,analyticsMs:analytics}),contentType:'application/json'});
  expect(browser).toBeLessThan(15000);expect(search).toBeLessThan(5000);expect(analytics).toBeLessThan(20000);
});
