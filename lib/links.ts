// Finds web links in chat messages and board posts, and the YouTube videos among them.
export type TextPart = {text:string;url?:string};

const LINK=/\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const TRAILING=/[.,;:!?'")\]}]+$/;
const YOUTUBE_HOSTS=new Set(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com']);
const VIDEO_ID=/^[\w-]{11}$/;

// Splits text into plain parts and link parts. A www. link is opened over https.
export function splitLinks(text:string):TextPart[]{
  const parts:TextPart[]=[];let last=0;
  for(const match of text.matchAll(LINK)){
    const link=match[0].replace(TRAILING,''),start=match.index;
    if(!link.includes('.')||link.endsWith('//'))continue;
    if(start>last)parts.push({text:text.slice(last,start)});
    parts.push({text:link,url:link.toLowerCase().startsWith('www.')?'https://'+link:link});
    last=start+link.length;
  }
  if(last<text.length)parts.push({text:text.slice(last)});
  return parts;
}

// The video id of a YouTube watch, short, live, embed or youtu.be link; null for anything else.
export function youtubeId(link:string):string|null{
  let url:URL;try{url=new URL(link)}catch{return null}
  const host=url.hostname.toLowerCase(),[first,second]=url.pathname.split('/').filter(Boolean);
  const id=host==='youtu.be'?first:YOUTUBE_HOSTS.has(host)?(first==='watch'?url.searchParams.get('v'):['shorts','live','embed'].includes(first)?second:null):null;
  return id&&VIDEO_ID.test(id)?id:null;
}

// Each distinct YouTube video linked in the text, in order of first mention.
export function youtubeIds(text:string):string[]{
  const ids=splitLinks(text).flatMap(part=>part.url?[youtubeId(part.url)]:[]).filter((id):id is string=>id!==null);
  return [...new Set(ids)];
}

