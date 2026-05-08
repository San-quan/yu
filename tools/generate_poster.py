import argparse
from io import BytesIO

import qrcode
from PIL import Image, ImageDraw
import requests


# ===================== 默认配置（可用命令行覆盖） =====================
DEFAULT = {
    "target_url": "https://jianliao.pages.dev",
    "bg_url": "https://i.imgant.com/v2/0Jny5nZ.png",
    "logo_url": "https://i.imgant.com/v2/KaN5x9T.jpeg",
    "qr_size": 630,
    "qr_left": 225,
    "qr_top": 300,
    "logo_size": 120,
    "border_radius": 15,
}


def get_image(url: str) -> Image.Image:
    resp = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()
    img = Image.open(BytesIO(resp.content))
    return img.convert("RGBA")


def generate_poster(
    target_url: str,
    bg_url: str,
    logo_url: str,
    qr_size: int,
    qr_left: int,
    qr_top: int,
    logo_size: int,
    border_radius: int,
) -> Image.Image:
    base_img = get_image(bg_url)
    logo = get_image(logo_url)

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=1,
    )
    qr.add_data(target_url)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
    qr_img = qr_img.resize((qr_size, qr_size), Image.Resampling.LANCZOS)

    logo = logo.resize((logo_size, logo_size), Image.Resampling.LANCZOS)

    mask = Image.new("L", (logo_size, logo_size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, logo_size, logo_size), border_radius, fill=255)

    output_logo = Image.new("RGBA", (logo_size, logo_size), (0, 0, 0, 0))
    output_logo.paste(logo, (0, 0), mask=mask)

    padding = 10
    bg_size = logo_size + padding
    logo_bg = Image.new("RGBA", (bg_size, bg_size), (0, 0, 0, 0))
    bg_draw = ImageDraw.Draw(logo_bg)
    bg_draw.rounded_rectangle(
        (0, 0, bg_size, bg_size),
        border_radius + 2,
        fill="white",
    )

    qr_center = (qr_size - bg_size) // 2
    qr_img.paste(logo_bg, (qr_center, qr_center), mask=logo_bg)

    inner_pos = (qr_size - logo_size) // 2
    qr_img.paste(output_logo, (inner_pos, inner_pos), mask=output_logo)

    base_img.paste(qr_img, (qr_left, qr_top), mask=qr_img)
    return base_img.convert("RGB")


def main() -> int:
    p = argparse.ArgumentParser(description="生成简聊不死活码海报（离线）")
    p.add_argument("--url", default=DEFAULT["target_url"], help="CF 中转页地址 / 二维码目标链接")
    p.add_argument("--target-url", default=None, help="兼容参数（同 --url）")
    p.add_argument("--bg-url", default=DEFAULT["bg_url"])
    p.add_argument("--logo-url", default=DEFAULT["logo_url"])
    p.add_argument("--qr-size", type=int, default=DEFAULT["qr_size"])
    p.add_argument("--qr-left", type=int, default=DEFAULT["qr_left"])
    p.add_argument("--qr-top", type=int, default=DEFAULT["qr_top"])
    p.add_argument("--logo-size", type=int, default=DEFAULT["logo_size"])
    p.add_argument("--border-radius", type=int, default=DEFAULT["border_radius"])
    p.add_argument("--output", default="new_jianliao_poster.png", help="输出文件名（PNG）")
    p.add_argument("--out", default=None, help="兼容参数（同 --output）")
    args = p.parse_args()

    target_url = args.url
    if args.target_url:
        target_url = args.target_url
    out = args.output
    if args.out:
        out = args.out

    img = generate_poster(
        target_url=target_url,
        bg_url=args.bg_url,
        logo_url=args.logo_url,
        qr_size=args.qr_size,
        qr_left=args.qr_left,
        qr_top=args.qr_top,
        logo_size=args.logo_size,
        border_radius=args.border_radius,
    )
    img.save(out, "PNG", quality=95)
    print("✅ 合成完毕！")
    print(f"📁 文件已保存为: {out}")
    print(f"🔗 链接地址: {target_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

