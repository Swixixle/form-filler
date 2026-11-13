# Draws the invented test forms. Synthetic test material: no real organisation's form.
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random, os
here = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures')
R = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 30)
B = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 44)
S = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)
W, H = 1700, 2200
im = Image.new('L', (W, H), 255); d = ImageDraw.Draw(im)
d.text((120, 100), 'Equipment Loan Request (invented form)', font=B, fill=0)
d.text((120, 170), 'Lakeside Training Center - synthetic test material, not a real form', font=S, fill=0)
def blank(x, y, label, length):
    d.text((x, y - 36), label, font=R, fill=0); lx = x + d.textlength(label, font=R) + 12
    d.line((lx, y, lx + length, y), fill=0, width=3)
blank(120, 320, 'Name:', 700); blank(1100, 320, 'Date:', 330)
blank(120, 420, 'Department:', 900)
# a table: header row of labels, two empty rows
x0, y0, cols, rh = 120, 520, [120, 720, 1220, 1580], 70
for r in range(4): d.line((x0, y0 + r * rh, cols[-1], y0 + r * rh), fill=0, width=3)
for c in cols: d.line((c, y0, c, y0 + 3 * rh), fill=0, width=3)
for c, t in zip(cols, ['Item', 'Serial number', 'Qty']): d.text((c + 14, y0 + 18), t, font=R, fill=0)
# checkboxes
d.text((120, 830), 'Shift:', font=R, fill=0)
for x, t in [(260, 'Day'), (460, 'Night')]:
    d.rectangle((x, 832, x + 30, 862), outline=0, width=3); d.text((x + 44, 830), t, font=R, fill=0)
# a comments box with a caption at its top
d.rectangle((120, 940, 1580, 1240), outline=0, width=3); d.text((136, 950), 'Comments', font=S, fill=0)
blank(120, 1380, 'Signature:', 800)
im.save(os.path.join(here, 'form.png'))
# The same page as a phone photo: turned 1.2 degrees, softened, a shadow across it, grain.
photo = im.convert('L').rotate(1.2, expand=False, fillcolor=255, resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(1.1))
px = photo.load(); random.seed(7)
for y in range(H):
    for x in range(0, W):
        shade = int(55 * (x / W))
        px[x, y] = max(0, min(255, px[x, y] - shade + random.randint(-12, 12)))
photo.save(os.path.join(here, 'form-photo.png'))
print('wrote form.png, form-photo.png')
# The same invented form as a real (vector) PDF, the way a form arrives by email.
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas as pdfcanvas
k = 612 / W
c = pdfcanvas.Canvas(os.path.join(here, 'form.pdf'), pagesize=letter, invariant=1)
Y = lambda y: 792 - y * k
c.setFont('Helvetica-Bold', 16); c.drawString(120 * k, Y(140), 'Equipment Loan Request (invented form)')
c.setFont('Helvetica', 8); c.drawString(120 * k, Y(195), 'Lakeside Training Center - synthetic test material, not a real form')
c.setLineWidth(1.1); c.setFont('Helvetica', 11)
def pblank(x, y, label, length):
    c.drawString(x * k, Y(y - 6), label); lx = x * k + c.stringWidth(label, 'Helvetica', 11) + 5
    c.line(lx, Y(y), lx + length * k, Y(y))
pblank(120, 320, 'Name:', 700); pblank(1100, 320, 'Date:', 330); pblank(120, 420, 'Department:', 900)
for r in range(4): c.line(x0 * k, Y(y0 + r * rh), cols[-1] * k, Y(y0 + r * rh))
for col in cols: c.line(col * k, Y(y0), col * k, Y(y0 + 3 * rh))
for col, t in zip(cols, ['Item', 'Serial number', 'Qty']): c.drawString((col + 14) * k, Y(y0 + 45), t)
c.drawString(120 * k, Y(860), 'Shift:')
for x, t in [(260, 'Day'), (460, 'Night')]: c.rect(x * k, Y(862), 30 * k, 30 * k); c.drawString((x + 44) * k, Y(860), t)
c.rect(120 * k, Y(1240), 1460 * k, 300 * k); c.setFont('Helvetica', 8); c.drawString(136 * k, Y(970), 'Comments'); c.setFont('Helvetica', 11)
pblank(120, 1380, 'Signature:', 800)
c.save(); print('wrote form.pdf')

# A PDF that declares its own fill-in fields (an AcroForm), as many official forms do. Invented.
c = pdfcanvas.Canvas(os.path.join(here, 'fillable.pdf'), pagesize=letter, invariant=1)
c.setFont('Helvetica-Bold', 16); c.drawString(72, 740, 'Visitor Pass Request (invented form)')
c.setFont('Helvetica', 8); c.drawString(72, 726, 'Lakeside Training Center - synthetic test material, not a real form')
c.setFont('Helvetica', 11); f = c.acroForm
rows = [('Full name', 'full_name', 680), ('E-mail', 'email', 650), ('Phone', 'phone', 620), ('Date', 'visit_date', 590)]
for label, name, y in rows:
    c.drawString(72, y + 4, label + ':'); f.textfield(name=name, tooltip=label, x=160, y=y, width=300, height=18, borderStyle='underlined', borderWidth=1, fillColor=None, forceBorder=True)
c.drawString(72, 554, 'Unit:'); f.choice(name='unit', tooltip='Unit', value='ICU', options=['ICU', 'Emergency', 'Floor'], fieldFlags='combo', x=160, y=550, width=150, height=18)
c.drawString(72, 524, 'Shift:')
for value, x in [('Day', 160), ('Night', 240)]:
    f.radio(name='shift', tooltip='Shift', value=value, selected=False, x=x, y=520, size=14, buttonStyle='circle'); c.drawString(x + 20, 523, value)
c.drawString(72, 494, 'Escort needed'); f.checkbox(name='escort', tooltip='Escort needed', x=160, y=490, size=14, checked=False)
c.drawString(72, 466, 'Reason for visit')
f.textfield(name='reason', tooltip='Reason for visit', x=72, y=380, width=440, height=80, fieldFlags='multiline', borderWidth=1, forceBorder=True)
c.drawString(72, 330, 'Signature'); c.line(160, 326, 460, 326)
c.save(); print('wrote fillable.pdf')

# A handwritten answer page, in handwriting-style fonts (Caveat, Patrick Hand; SIL Open Font License) on ruled paper,
# each word nudged and turned a little, shaded like a phone photo. Synthetic: no real person's handwriting.
fonts = os.path.join(os.path.dirname(__file__), '..', 'node_modules', '@fontsource')
HAND = [ImageFont.truetype(os.path.join(fonts, 'caveat', 'files', 'caveat-latin-400-normal.woff'), 74),
        ImageFont.truetype(os.path.join(fonts, 'patrick-hand', 'files', 'patrick-hand-latin-400-normal.woff'), 62)]
LINES = ['Jane Roe', '11/13/2026', 'Respiratory Care', 'Ventilator VNT 2219', 'Return by Friday']
page = Image.new('L', (1400, 1100), 250); d = ImageDraw.Draw(page); random.seed(11)
for y in range(150, 1100, 150): d.line((0, y, 1400, y), fill=175, width=2)          # the paper's rules
d.line((140, 0, 140, 1100), fill=190, width=2)                                         # its margin line
for row, text in enumerate(LINES):
    x, font = 190, HAND[row % 2]
    for word in text.split(' '):
        w = int(d.textlength(word, font=font)) + 30
        tile = Image.new('L', (w, 130), 0); ImageDraw.Draw(tile).text((10, 10), word, font=font, fill=255)
        tile = tile.rotate(random.uniform(-3, 3), resample=Image.BICUBIC, expand=False)
        page.paste(Image.new('L', tile.size, 40), (x, 150 * (row + 1) - 112 + random.randint(-5, 5)), tile)
        x += w - 10 + random.randint(0, 12)
page = page.filter(ImageFilter.GaussianBlur(0.8)); px = page.load()
for y in range(page.height):
    for x in range(page.width): px[x, y] = max(0, min(255, px[x, y] - int(35 * y / page.height) + random.randint(-8, 8)))
page.save(os.path.join(here, 'handwritten.png')); print('wrote handwritten.png')
