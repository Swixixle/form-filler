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
c = pdfcanvas.Canvas(os.path.join(here, 'form.pdf'), pagesize=letter)
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
