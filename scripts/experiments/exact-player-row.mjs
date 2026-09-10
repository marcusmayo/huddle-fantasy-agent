// Use the observed full title, never substring matching (9 also matches 90).
export function exactPlayerRow(page,name){
  if(typeof name!=='string'||!name.trim())throw Error('Observed player name required');
  return page.locator('tr').filter({has:page.getByTitle(name,{exact:true})});
}
