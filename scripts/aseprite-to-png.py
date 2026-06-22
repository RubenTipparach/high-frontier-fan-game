#!/usr/bin/env python3
"""Minimal Aseprite -> PNG converter. Composites visible layers, frame 0 (or all frames).
Handles color depth 32 (RGBA), 16 (grayscale), 8 (indexed). Cel types 0/1/2."""
import sys, struct, zlib
from PIL import Image

def u16(b,o): return struct.unpack_from('<H', b, o)[0]
def s16(b,o): return struct.unpack_from('<h', b, o)[0]
def u32(b,o): return struct.unpack_from('<I', b, o)[0]

def parse(path):
    d = open(path,'rb').read()
    fsz=u32(d,0); magic=u16(d,4)
    assert magic==0xA5E0, f"bad magic {magic:#x}"
    frames=u16(d,6); W=u16(d,8); H=u16(d,10); depth=u16(d,12)
    ncolors=u16(d,32); transparent=d[28]
    o=128
    palette={}
    layers=[]   # (flags, name, opacity)
    frame_cels=[]  # per frame: list of (layer, x, y, w, h, rgba_bytes)
    for fi in range(frames):
        fbytes=u32(d,o); fmagic=u16(d,o+4)
        old_nchunks=u16(d,o+6); nchunks=u32(d,o+16)
        if nchunks==0: nchunks=old_nchunks
        co=o+16+ ( -12+16 )  # header is 16 bytes
        co=o+16
        cels=[]
        frame_end=o+fbytes
        for ci in range(nchunks):
            if co+6>frame_end or co+6>len(d): break
            csz=u32(d,co); ctype=u16(d,co+4); cdata_off=co+6; cend=co+csz
            if cend>len(d): cend=len(d)
            if ctype==0x2004:  # layer
                flags=u16(d,cdata_off); ltype=u16(d,cdata_off+2)
                opacity=d[cdata_off+10]
                nlen=u16(d,cdata_off+16); name=d[cdata_off+18:cdata_off+18+nlen].decode('utf8','replace')
                layers.append((flags,name,opacity))
            elif ctype in (0x2019,):  # new palette
                psize=u32(d,cdata_off); first=u32(d,cdata_off+4); last=u32(d,cdata_off+8)
                eo=cdata_off+20
                for pi in range(first,last+1):
                    eflags=u16(d,eo); r=d[eo+2];g=d[eo+3];b=d[eo+4];a=d[eo+5]; eo+=6
                    if eflags & 1:
                        nl=u16(d,eo); eo+=2+nl
                    palette[pi]=(r,g,b,a)
            elif ctype in (0x0004,0x0011):  # old palette
                npk=u16(d,cdata_off); eo=cdata_off+2; idx=0
                for pk in range(npk):
                    skip=d[eo]; cnt=d[eo+1]; eo+=2
                    if cnt==0: cnt=256
                    idx+=skip
                    for k in range(cnt):
                        r=d[eo];g=d[eo+1];b=d[eo+2]; eo+=3
                        palette[idx]=(r,g,b,255); idx+=1
            elif ctype==0x2005:  # cel
                layer=u16(d,cdata_off); x=s16(d,cdata_off+2); y=s16(d,cdata_off+4)
                opacity=d[cdata_off+6]; celtype=u16(d,cdata_off+7)
                po=cdata_off+16
                if celtype in (0,2):
                    cw=u16(d,po); ch=u16(d,po+2); pix=d[po+4:cend]
                    if celtype==2: pix=zlib.decompress(pix)
                    rgba=to_rgba(pix,cw,ch,depth,palette,transparent)
                    cels.append((layer,x,y,cw,ch,rgba,opacity))
                elif celtype==1:
                    link=u16(d,po)
                    # copy from linked frame same layer
                    for (l2,x2,y2,w2,h2,rgba2,op2) in frame_cels[link]:
                        if l2==layer:
                            cels.append((layer,x2,y2,w2,h2,rgba2,op2)); break
            co=cend
        frame_cels.append(cels)
        o+=fbytes
    return W,H,depth,layers,frame_cels

def to_rgba(pix,w,h,depth,palette,transparent):
    out=bytearray(w*h*4)
    if depth==32:
        return bytes(pix[:w*h*4])
    elif depth==16:  # grayscale value,alpha
        for i in range(w*h):
            v=pix[i*2]; a=pix[i*2+1]
            out[i*4]=v;out[i*4+1]=v;out[i*4+2]=v;out[i*4+3]=a
    elif depth==8:
        for i in range(w*h):
            idx=pix[i]
            if idx==transparent:
                out[i*4:i*4+4]=b'\0\0\0\0'
            else:
                r,g,b,a=palette.get(idx,(0,0,0,255))
                out[i*4]=r;out[i*4+1]=g;out[i*4+2]=b;out[i*4+3]=a
    return bytes(out)

def composite(W,H,layers,cels):
    base=Image.new('RGBA',(W,H),(0,0,0,0))
    for (layer,x,y,w,h,rgba,opacity) in cels:
        if layer<len(layers):
            flags=layers[layer][0]
            if not (flags & 1):  # not visible
                continue
        im=Image.frombytes('RGBA',(w,h),rgba)
        base.alpha_composite(im,(x,y))
    return base

if __name__=='__main__':
    inp=sys.argv[1]; outp=sys.argv[2]
    allframes='--all' in sys.argv
    W,H,depth,layers,frame_cels=parse(inp)
    print(f"{inp}: {W}x{H} depth{depth} frames={len(frame_cels)} layers={len(layers)}")
    if allframes:
        for fi,cels in enumerate(frame_cels):
            composite(W,H,layers,cels).save(outp.replace('.png',f'_f{fi}.png'))
    else:
        composite(W,H,layers,frame_cels[0]).save(outp)
    print("wrote", outp)
