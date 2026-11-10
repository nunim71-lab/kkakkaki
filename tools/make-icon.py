import sys, math
# 깍깍이 아이콘 다시 그리기 (개발용, Pillow 필요): python3 tools/make-icon.py tools/icon.ico public/icon.png
# 휴대폰을 들고 "깍깍" 말풍선을 띄우는 까마귀 (재잘이 동생). 흰 스티커 테두리로 어떤 바탕화면에서도 잘 보이게 함.
from PIL import Image, ImageDraw, ImageFilter, ImageChops

S = 2048
k = S / 1024
def P(*v): return [x * k for x in v]
def layer(): return Image.new('RGBA', (S, S), (0, 0, 0, 0))

BODY = (44, 40, 74, 255)
WING = (33, 30, 58, 255)
SHEEN = (125, 115, 210, 85)
BEAK = (92, 88, 128, 255)
BEAK_HI = (150, 146, 190, 255)
GOLD = (255, 205, 80, 255)
GOLD_DARK = (200, 140, 20, 255)
PUPIL = (24, 22, 44, 255)
SCREEN = (120, 225, 200, 255)
BUBBLE = (255, 255, 255, 255)
BUBBLE_LINE = (79, 61, 140, 255)

img = layer()
def comp(l):
    global img
    img = Image.alpha_composite(img, l)

def rot(l, ang, cx, cy):
    return l.rotate(ang, center=(cx * k, cy * k), resample=Image.BICUBIC)

def ellipse(cx, cy, rx, ry, ang, fill):
    l = layer(); ImageDraw.Draw(l).ellipse(P(cx - rx, cy - ry, cx + rx, cy + ry), fill=fill)
    return rot(l, ang, cx, cy)

def poly(pts, fill):
    l = layer(); ImageDraw.Draw(l).polygon([(x * k, y * k) for x, y in pts], fill=fill)
    return l

# ---- 꼬리 ----
for ang, length in ((-10, 200), (4, 230), (18, 190)):
    t = layer(); d = ImageDraw.Draw(t)
    d.polygon([(x * k, y * k) for x, y in [(330, 760 - 40), (280 - length, 760 - 14), (250 - length, 760), (280 - length, 760 + 14), (330, 760 + 40)]], fill=WING)
    comp(rot(t, ang - 28, 330, 760))

# ---- 다리 ----
legs = layer(); d = ImageDraw.Draw(legs)
for lx in (420, 500):
    d.rounded_rectangle(P(lx - 11, 820, lx + 11, 905), radius=10 * k, fill=BEAK)
    for dx in (-26, 0, 26):
        d.rounded_rectangle(P(lx + dx - 15, 887, lx + dx + 15, 909), radius=10 * k, fill=BEAK)
comp(legs)

# ---- 몸 ----
comp(ellipse(470, 665, 210, 185, -14, BODY))

# ---- 머리 ----
for cx, cy, ang in ((410, 215, 24), (460, 200, 0), (508, 220, -24)):   # 머리 깃털
    comp(ellipse(cx, cy, 24, 62, ang, BODY))
comp(ellipse(460, 400, 185, 172, 0, BODY))
sheen = layer(); ImageDraw.Draw(sheen).ellipse(P(325, 265, 510, 385), fill=SHEEN)
comp(sheen.filter(ImageFilter.GaussianBlur(24 * k)))

# 눈: 두 눈 모두 반짝반짝 (형 재잘이는 윙크, 동생 깍깍이는 동그란 눈)
eyes = layer(); d = ImageDraw.Draw(eyes)
for ex, look in ((385, 10), (540, 10)):
    d.ellipse(P(ex - 54, 385 - 60, ex + 54, 385 + 60), fill=(255, 255, 255, 255))
    px = ex + look
    d.ellipse(P(px - 36, 398 - 40, px + 36, 398 + 40), fill=PUPIL)
    d.ellipse(P(px - 26, 366 - 16, px - 2, 366 + 8), fill=(255, 255, 255, 255))
    d.ellipse(P(px + 8, 408, px + 20, 420), fill=(255, 255, 255, 220))
comp(eyes)
# 볼터치
blush = layer(); d = ImageDraw.Draw(blush)
for bx in (322, 604):
    d.ellipse(P(bx - 40, 480 - 22, bx + 40, 480 + 22), fill=(255, 120, 165, 190))
comp(blush.filter(ImageFilter.GaussianBlur(4 * k)))
# 벌린 부리 ("깍!" 하고 우는 중): 위 부리 + 아래 부리
comp(poly([(425, 448), (495, 448), (470, 535)], BEAK))
comp(ellipse(460, 452, 38, 20, 0, BEAK))
comp(poly([(442, 452), (460, 452), (462, 505)], BEAK_HI))
comp(poly([(440, 548), (485, 540), (462, 590)], BEAK))
# 머리 위 작은 금색 리본 (형제 표시: 재잘이는 금테 안경, 깍깍이는 금색 나비 리본)
bow = layer(); d = ImageDraw.Draw(bow)
d.polygon([(x * k, y * k) for x, y in [(560, 255), (630, 215), (640, 290)]], fill=GOLD)
d.polygon([(x * k, y * k) for x, y in [(560, 255), (500, 210), (500, 285)]], fill=GOLD)
d.ellipse(P(545, 238, 578, 272), fill=GOLD_DARK)
comp(rot(bow, -15, 565, 255))

# ---- 휴대폰 (날개로 들고 있음) ----
phone = layer(); d = ImageDraw.Draw(phone)
x0, y0, x1, y1 = 600, 560, 760, 850
d.rounded_rectangle(P(x0 - 10, y0 - 10, x1 + 10, y1 + 10), radius=34 * k, fill=BUBBLE_LINE)
d.rounded_rectangle(P(x0, y0, x1, y1), radius=26 * k, fill=GOLD)
d.rounded_rectangle(P(x0 + 16, y0 + 34, x1 - 16, y1 - 40), radius=12 * k, fill=SCREEN)
d.rounded_rectangle(P(x0 + 55, y0 + 12, x1 - 55, y0 + 22), radius=5 * k, fill=GOLD_DARK)
# 화면 속 작은 말풍선 두 줄
d.rounded_rectangle(P(x0 + 30, y0 + 60, x1 - 40, y0 + 105), radius=14 * k, fill=(255, 255, 255, 255))
d.rounded_rectangle(P(x0 + 55, y0 + 125, x1 - 28, y0 + 170), radius=14 * k, fill=(255, 236, 170, 255))
d.rounded_rectangle(P(x0 + 30, y0 + 190, x1 - 60, y0 + 235), radius=14 * k, fill=(255, 255, 255, 255))
d.ellipse(P((x0 + x1) / 2 - 14, y1 - 30, (x0 + x1) / 2 + 14, y1 - 6), fill=GOLD_DARK)
comp(rot(phone, -12, 680, 705))
comp(ellipse(612, 735, 62, 98, 25, WING))   # 휴대폰 쥔 날개

# ---- 말풍선 (휴대폰 위로 "콕콕" 날아가는 문자) ----
bub = layer(); d = ImageDraw.Draw(bub)
bx0, by0, bx1, by1 = 640, 175, 940, 420
d.rounded_rectangle(P(bx0 - 12, by0 - 12, bx1 + 12, by1 + 12), radius=80 * k, fill=BUBBLE_LINE)
d.polygon([(x * k, y * k) for x, y in [(690, by1 - 10), (650, by1 + 95), (770, by1 - 10)]], fill=BUBBLE_LINE)
d.rounded_rectangle(P(bx0, by0, bx1, by1), radius=70 * k, fill=BUBBLE)
d.polygon([(x * k, y * k) for x, y in [(700, by1 - 14), (668, by1 + 68), (758, by1 - 14)]], fill=BUBBLE)
for i, cx in enumerate((715, 790, 865)):   # 점 세 개 (문자 쓰는 중)
    col = (GOLD, GOLD_DARK, BUBBLE_LINE)[i]
    d.ellipse(P(cx - 30, 297 - 30, cx + 30, 297 + 30), fill=col)
comp(bub)
# 반짝이
spark = layer(); pts = []
for i in range(8):
    a = math.pi / 4 * i - math.pi / 2
    rr = 40 if i % 2 == 0 else 12
    pts.append(((950 + rr * math.cos(a)) * k, (130 + rr * math.sin(a)) * k))
ImageDraw.Draw(spark).polygon(pts, fill=GOLD)
comp(spark)

# ---- 흰 스티커 테두리 + 은은한 그림자 ----
alpha = img.split()[3]
def grow(mask, r):
    return mask.filter(ImageFilter.GaussianBlur(r * k)).point(lambda v: 255 if v > 10 else 0).filter(ImageFilter.GaussianBlur(1.5 * k))
white = grow(alpha, 18)
shadow = Image.new('RGBA', (S, S), (79, 61, 140, 0)); shadow.putalpha(grow(alpha, 24).point(lambda v: v * 60 // 255))
base = Image.alpha_composite(layer(), ImageChops.offset(shadow, 0, int(10 * k)).filter(ImageFilter.GaussianBlur(6 * k)))
sticker = Image.new('RGBA', (S, S), (255, 255, 255, 0)); sticker.putalpha(white)
img = Image.alpha_composite(Image.alpha_composite(base, sticker), img)

char = img.crop(img.getbbox())
side = int(max(char.size) * 1.03)
img = Image.new('RGBA', (side, side), (0, 0, 0, 0))
img.paste(char, ((side - char.size[0]) // 2, (side - char.size[1]) // 2), char)
final = img.resize((512, 512), Image.LANCZOS)
final.save(sys.argv[1], sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
final.resize((256, 256), Image.LANCZOS).save(sys.argv[2])
