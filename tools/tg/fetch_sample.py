import asyncio, json, os, sys
from telethon import TelegramClient
from telethon.sessions import StringSession
from common import API_ID, API_HASH
SESSION=os.environ.get("TG_SESSION") or open(os.path.join(os.path.dirname(__file__),"session.txt")).read().strip()
OUT=os.path.join(os.path.dirname(__file__),"..","..","data","posts_raw.json")
async def main():
    n=int(sys.argv[1]) if len(sys.argv)>1 else 60
    c=TelegramClient(StringSession(SESSION),API_ID,API_HASH,connection_retries=3,timeout=30)
    await c.connect()
    ch=await c.get_entity('aniplus')
    out=[]
    async for m in c.iter_messages(ch, limit=n):
        ents=[]
        for e in (m.entities or []):
            d={'t':type(e).__name__,'o':getattr(e,'offset',None),'l':getattr(e,'length',None)}
            if getattr(e,'url',None): d['url']=e.url
            ents.append(d)
        btns=[]
        if m.buttons:
            rows=m.buttons if isinstance(m.buttons,list) else m.buttons.rows
            for r in rows:
                cells=r.buttons if hasattr(r,'buttons') else r
                btns.append([{'t':x.text,'url':getattr(x,'url',None),'data':(x.data.decode('utf-8','replace') if getattr(x,'data',None) else None)} for x in cells])
        out.append({'id':m.id,'date':m.date.isoformat(),'text':m.text or '','entities':ents,'buttons':btns,'has_media':bool(m.media),'media_type':type(m.media).__name__ if m.media else None})
    json.dump(out,open(OUT,'w'),ensure_ascii=False,indent=1)
    print('saved',len(out),'to',OUT)
    await c.disconnect()
asyncio.run(main())
