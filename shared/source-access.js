import robotsParser from 'robots-parser';
import {fetchPage} from './prices.js';
const robotsCache=new Map();
export async function allowed(url,source,fetcher=fetch){
 const origin=new URL(url).origin,key=origin;let entry=robotsCache.get(key);
 if(!entry||entry.until<Date.now()){
  let text='';try{text=(await fetchPage(origin+'/robots.txt',source,fetcher)).html;}catch(e){if(!e.message.includes('HTTP 404'))throw e;}
  entry={text,until:Date.now()+300000};robotsCache.set(key,entry);
 }
 if(robotsParser(origin+'/robots.txt',entry.text).isAllowed(url,'DaeguPriceBoard')===false)throw Error('원본 robots.txt에서 이 조회를 허용하지 않습니다.');
}
