# render single frames for inspection: python3 stills.py t1 t2 ...
import sys, numpy as np
ARGS=sys.argv[1:]; sys.argv=sys.argv[:1]
import render as R
from PIL import Image
rng=np.random.default_rng(0)
imgs={s['f']:R.load_shot(s) for s in R.SHOTS}
grain=R.make_grain(2,rng)
def frame(t):
    fr=np.zeros((R.H,R.W),np.float32)
    for s in R.SHOTS:
        a=R.shot_alpha(s,t)
        if a>0: fr+=R.shot_frame(s,imgs[s['f']],t,rng)*a
    fr=R.halation(np.clip(fr,0,1))*R.VIGNETTE
    bh=R.band_h(t)*R.S; top,bot=int(R.H/2-bh/2),int(R.H/2+bh/2)
    m=np.zeros(R.H,np.float32); m[top:bot]=1; fr*=m[:,None]
    fr=np.clip(fr+grain[0]*(0.055*m[:,None]+0.006),0,1)
    rgb=R.tint(fr)
    for q in R.QUOTES:
        for k,((txt,ti),gl) in enumerate(zip(q['lines'],q['imgs'])):
            R.paste_text(rgb,gl,R.text_alpha(t,ti,q['out'],q.get('hard',False)),R.W/2,q['y']+k*R.LINE)
    R.paste_text(rgb,R.SIGN['img'],R.text_alpha(t,R.SIGN['t0'],R.SIGN['t1'],fin=1.0,fout=0.9)*0.8,R.W/2,R.H/2)
    return Image.fromarray((np.clip(rgb,0,1)*255).astype(np.uint8))
import os; os.makedirs('stills',exist_ok=True)
for t in [float(a) for a in ARGS] or [18,31,33,53]:
    frame(t).save('stills/t%05.1f.jpg'%t,quality=88)
