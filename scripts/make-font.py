#!/usr/bin/env python3
"""裁剪 LXGW WenKai 为读数/评级专用子集(--font-num)。

完整字体(约 25MB,47k 字形)不入库不打包,仅作本地裁剪源
(src/assets/fonts/LXGWWenKai-Regular.ttf,已 gitignore);本脚本按
--font-num 实际渲染的字符集裁剪:可打印 ASCII(数字/评级字母/标点)
+ U+00B7 间隔号 + U+2014 em dash(评级缺省兜底字符)。
产物 src/assets/fonts/LXGWWenKaiNum.ttf 随包内置;重跑覆盖。
依赖:python3 + fontTools(pip3 install fonttools)。
"""
import os
import sys

from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src/assets/fonts/LXGWWenKai-Regular.ttf')
DST = os.path.join(ROOT, 'src/assets/fonts/LXGWWenKaiNum.ttf')

CODEPOINTS = [*range(0x20, 0x7F), 0xB7, 0x2014]


def main() -> int:
    if not os.path.exists(SRC):
        print(f'缺完整字体源: {SRC}', file=sys.stderr)
        return 1

    options = subset.Options()
    # 保留完整 name 表与全部 layout 特性(OFL 署名要求 + 字距表现)
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.layout_features = ['*']
    options.recalc_bounds = True

    font = subset.load_font(SRC, options)
    before_glyphs = font['maxp'].numGlyphs
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=CODEPOINTS)
    subsetter.subset(font)
    subset.save_font(font, DST, options)

    after_cmap = font.getBestCmap()
    missing = [f'U+{cp:04X}' for cp in CODEPOINTS if cp not in after_cmap]
    print(f'完整字体: {os.path.getsize(SRC) / 1024:.0f}KB / {before_glyphs} 字形')
    print(f'裁剪产物: {DST}')
    print(f'          {os.path.getsize(DST) / 1024:.1f}KB / {font["maxp"].numGlyphs} 字形 / {len(after_cmap)} 码位')
    if missing:
        print(f'警告: 源字体缺这些码位: {", ".join(missing)}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
