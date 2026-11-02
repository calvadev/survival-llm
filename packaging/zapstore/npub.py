"""Derive the public npub from a Nostr nsec without any dependency.

Usage: python3 packaging/zapstore/npub.py  (reads NOSTR_NSEC from the environment)

Prints the npub1... public key. The nsec is only ever read from the
environment and is never printed. Pure Python: bech32 decode (nsec),
secp256k1 public-key derivation, bech32 encode (npub).
"""
import os
import sys

CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def bech32_decode(bech):
    bech = bech.strip().lower()
    pos = bech.rfind("1")
    if pos < 1:
        sys.exit("not a bech32 string")
    hrp = bech[:pos]
    data = [CHARSET.index(c) for c in bech[pos + 1:]]
    return hrp, data[:-6]


def convertbits(data, frombits, tobits, pad=True):
    acc = 0
    bits = 0
    ret = []
    maxv = (1 << tobits) - 1
    for value in data:
        acc = (acc << frombits) | value
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (tobits - bits)) & maxv)
    return ret


def bech32_encode(hrp, payload):
    data = convertbits(payload, 8, 5)

    def polymod(values):
        gen = (0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3)
        chk = 1
        for v in values:
            top = chk >> 25
            chk = ((chk & 0x1FFFFFF) << 5) ^ v
            for i in range(5):
                chk ^= gen[i] if (top >> i) & 1 else 0
        return chk

    hrp_expand = [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]
    mod = polymod(hrp_expand + data + [0] * 6) ^ 1
    combined = data + [(mod >> 5 * (5 - i)) & 31 for i in range(6)]
    return hrp + "1" + "".join(CHARSET[d] for d in combined)


P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
     0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)


def point_mul(k, point):
    result = None
    addend = point
    while k:
        if k & 1:
            result = point_add(result, addend)
        addend = point_add(addend, addend)
        k >>= 1
    return result


def point_add(p, q):
    if p is None:
        return q
    if q is None:
        return p
    if p[0] == q[0] and (p[1] + q[1]) % P == 0:
        return None
    if p == q:
        m = (3 * p[0] * p[0]) * pow(2 * p[1], P - 2, P) % P
    else:
        m = (q[1] - p[1]) * pow(q[0] - p[0], P - 2, P) % P
    x = (m * m - p[0] - q[0]) % P
    return (x, (m * (p[0] - x) - p[1]) % P)


def main():
    nsec = os.environ.get("NOSTR_NSEC", "")
    if not nsec.startswith("nsec1"):
        sys.exit("NOSTR_NSEC must be an nsec1... key")
    hrp, data = bech32_decode(nsec)
    if hrp != "nsec":
        sys.exit("NOSTR_NSEC does not decode with the nsec prefix")
    secret = int.from_bytes(bytes(convertbits(data, 5, 8, False)), "big")
    if not 1 <= secret < N:
        sys.exit("NOSTR_NSEC decodes to an invalid secret")
    x_only = point_mul(secret, G)[0]
    print(bech32_encode("npub", list(x_only.to_bytes(32, "big"))))


if __name__ == "__main__":
    main()
