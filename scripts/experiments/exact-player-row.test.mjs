import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {exactPlayerRow} from './exact-player-row.mjs';const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/marcu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
test('exact visible title isolates a player from prefix-sharing names after row reorder',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});try{
    const page=await browser.newPage();await page.setContent('<table><tbody>'+[90,99,9].map(n=>'<tr><td><span title="Fixture Player '+n+'">Fixture Player '+n+'</span></td><td><button onclick="document.body.dataset.clicked='+n+'">Draft</button></td></tr>').join('')+'</tbody></table>');
    assert.equal(await page.locator('tr').filter({has:page.locator('span[title]').filter({hasText:'Fixture Player 9'})}).count(),3);
    const row=exactPlayerRow(page,'Fixture Player 9');assert.equal(await row.count(),1);await row.getByRole('button',{name:'Draft',exact:true}).click();assert.equal(await page.getAttribute('body','data-clicked'),'9');
    await page.evaluate(()=>{const body=document.querySelector('tbody');body.prepend(body.lastElementChild);});assert.equal(await row.count(),1);await row.getByRole('button',{name:'Draft',exact:true}).click();assert.equal(await page.getAttribute('body','data-clicked'),'9');
    assert.equal(await exactPlayerRow(page,'Missing Player').count(),0);
  }finally{await browser.close();}
});
