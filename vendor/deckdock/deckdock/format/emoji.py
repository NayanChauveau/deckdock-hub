"""The `deck.icon` rule: a single emoji, written as text.

Standard library only (no grapheme segmentation available), so the rule is explicit: one emoji
element, or several joined by ZWJ; a flag (two regional indicators); a keycap; or a tag sequence
(subdivision flags such as Scotland).
"""

MAX_ICON_BYTES = 64

_ZWJ = 0x200D
_VS16 = 0xFE0F
_KEYCAP = 0x20E3
_BLACK_FLAG = 0x1F3F4
_TAG_END = 0xE007F
_SKIN_TONES = range(0x1F3FB, 0x1F3FF + 1)
_REGIONAL = range(0x1F1E6, 0x1F1FF + 1)
_TAGS = range(0xE0020, 0xE007E + 1)
_KEYCAP_BASES = frozenset(map(ord, "0123456789#*"))

_PICTOGRAPHIC = (
    (0x00A9, 0x00A9),
    (0x00AE, 0x00AE),
    (0x203C, 0x203C),
    (0x2049, 0x2049),
    (0x2122, 0x2122),
    (0x2139, 0x2139),
    (0x2194, 0x21AA),
    (0x231A, 0x23FF),
    (0x24C2, 0x24C2),
    (0x25AA, 0x25FE),
    (0x2600, 0x27BF),
    (0x2934, 0x2935),
    (0x2B05, 0x2B55),
    (0x3030, 0x3030),
    (0x303D, 0x303D),
    (0x3297, 0x3297),
    (0x3299, 0x3299),
    (0x1F000, 0x1FAFF),
)


def _pictographic(code: int) -> bool:
    if code in _REGIONAL or code in _SKIN_TONES:
        return False
    return any(low <= code <= high for low, high in _PICTOGRAPHIC)


def _element(codes: list[int]) -> bool:
    """One pictograph, then at most one skin tone and at most one VS16, in any order."""
    if not codes or not _pictographic(codes[0]):
        return False
    modifiers = codes[1:]
    if len(modifiers) > 2:
        return False
    tones = [code for code in modifiers if code in _SKIN_TONES]
    selectors = [code for code in modifiers if code == _VS16]
    return (
        len(tones) <= 1
        and len(selectors) <= 1
        and len(tones) + len(selectors) == len(modifiers)
    )


def is_single_emoji(value: str) -> bool:
    if not value or len(value.encode("utf-8")) > MAX_ICON_BYTES:
        return False
    codes = [ord(char) for char in value]
    if all(code in _REGIONAL for code in codes):
        return len(codes) == 2
    if codes[0] in _KEYCAP_BASES:
        return codes[1:] in ([_KEYCAP], [_VS16, _KEYCAP])
    if codes[0] == _BLACK_FLAG and len(codes) > 2 and codes[-1] == _TAG_END:
        return all(code in _TAGS for code in codes[1:-1])
    parts: list[list[int]] = [[]]
    for code in codes:
        if code == _ZWJ:
            parts.append([])
        else:
            parts[-1].append(code)
    return all(_element(part) for part in parts)
