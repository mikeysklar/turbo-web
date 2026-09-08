# Mandelbrot, the way it gets written before anyone thinks about speed.
# One file, one hot loop, one float helper, one thing that talks to hardware.
import time


def mandel_row(out: ptr8, width: int, dx: int, cy: int, max_iter: int):
    # fixed point, 12 fractional bits, integers only so viper can take it
    for px in range(width):
        cx = px * dx - (2 << 12)
        x = 0
        y = 0
        i = 0
        while i < max_iter:
            x2 = (x * x) >> 12
            y2 = (y * y) >> 12
            if x2 + y2 > (4 << 12):
                break
            y = ((x * y) >> 11) + cy
            x = x2 - y2 + cx
            i += 1
        out[px] = i


def blend(out, n):
    # dims the row before it goes to the display
    for i in range(n):
        out[i] = int(out[i] * 0.5)


def update_display(bmp, row, y):
    import displayio
    for x in range(len(row)):
        bmp[x, y] = row[x]


def run():
    W, H, IT = 160, 120, 64
    row = bytearray(W)
    dx = (3 << 12) // W
    total = 0
    for r in range(H):
        mandel_row(row, W, dx, ((r * 2) << 12) // H - (1 << 12), IT)
        total += sum(row)
    return total


t0 = time.monotonic_ns()
checksum = run()
ms = (time.monotonic_ns() - t0) // 1_000_000
print("checksum=%d ms=%d" % (checksum, ms))
