"""選手の照合：外部データの選手名を既存の選手（key）に結びつける。

判定
  known     … 既存の選手と完全一致（表記ゆれ辞書 build_fights.ALIASES 適用後）→ 既存の key をそのまま使う
  new       … 似た名前の既存選手がいない新しい選手 → 新規として追加可（key は build_fights が自動で付ける）
  variant   … 語順・アクセント・記号だけ違う既存選手がいる → 要確認（自動では結びつけない）
  similar   … 綴りが近い既存選手がいる（表記ゆれ or 別人） → 要確認
  conflict  … 同名の既存選手と性別区分が食い違う（同姓同名の別人の可能性） → 要確認
推測で結びつけることはせず、曖昧なものは必ず要確認に回す。
"""
import difflib

from normalize import bf, name_key


class FighterIndex:
    def __init__(self, people):
        """people: build_fights.build() の people（key -> [英語名, 国コード, 階級]）"""
        self.people = people
        self.key_of = {v[0]: k for k, v in people.items()}
        self.by_nkey = {}
        for name in self.key_of:
            self.by_nkey.setdefault(name_key(name), []).append(name)
        self.nkeys = list(self.by_nkey)

    def country(self, name):
        k = self.key_of.get(name)
        return self.people[k][1] if k else ""

    def match(self, name, female=None):
        """→ (status, key or None, candidates[list of names])"""
        if name in self.key_of:
            k = self.key_of[name]
            div = self.people[k][2]
            if female is not None and div and (div == "女子") != female:
                return "conflict", k, [name]
            return "known", k, []
        nk = name_key(name)
        if nk in self.by_nkey:
            return "variant", None, self.by_nkey[nk]
        close = difflib.get_close_matches(nk, self.nkeys, n=3, cutoff=0.88)
        if not close:
            # 姓（最後の語）が同じで名が近い：Kyouma / Kyoma など
            toks = name.lower().split()
            if len(toks) >= 2:
                for other in self.key_of:
                    ot = other.lower().split()
                    if len(ot) >= 2 and ot[-1] == toks[-1] and difflib.SequenceMatcher(None, ot[0], toks[0]).ratio() >= 0.8 and ot[0] != toks[0]:
                        close.append(name_key(other))
        if close:
            return "similar", None, sorted({n for c in close for n in self.by_nkey.get(c, [])})
        return "new", None, []


def new_key(name, people):
    """新規選手に build_fights が付ける key（表示用の予測）"""
    k = bf.slug(name)
    used = set(people)
    while k in used:
        k += "-2"
    return k
