#!/usr/bin/env python3
"""
从本机 Chrome 读出自己的B站登录 Cookie，写进 .env.local 的 BILI_COOKIE（该文件不进仓库）。

- Chrome 的 cookie 值用 AES-128-CBC 加密，密钥在 macOS Keychain 的 "Chrome Safe Storage"；
  第一次运行系统可能弹窗询问是否允许读取，选「始终允许」后不再询问。
- 只读 .bilibili.com 下的几个登录相关 cookie；全程不打印任何 cookie 值。
- 退出码：0 成功；1 没找到登录状态；3 macOS 拒绝访问浏览器数据目录。
用法：python3 scripts/commentary/refresh-cookie.py
"""
import glob, hashlib, os, shutil, sqlite3, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENV = os.path.join(ROOT, ".env.local")
WANT = ["SESSDATA", "bili_jct", "DedeUserID", "buvid3", "buvid4", "b_nut"]

BROWSERS = [
    ("Chrome", "~/Library/Application Support/Google/Chrome", "Chrome"),
    ("Edge", "~/Library/Application Support/Microsoft Edge", "Microsoft Edge"),
    ("Brave", "~/Library/Application Support/BraveSoftware/Brave-Browser", "Brave"),
]


def keychain_key(service):
    try:
        pw = subprocess.run(
            ["security", "find-generic-password", "-w", "-s", f"{service} Safe Storage"],
            capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        raise SystemExit("读取 Keychain 超时：请在终端里直接运行本脚本，让系统弹窗出现")
    if pw.returncode != 0:
        raise SystemExit(f"拿不到 {service} 的 Keychain 密钥：{pw.stderr.strip()[:120]}")
    return hashlib.pbkdf2_hmac("sha1", pw.stdout.strip().encode(), b"saltysalt", 1003, 16)


def decrypt(blob, key):
    if not blob:
        return ""
    if blob[:3] not in (b"v10", b"v11"):
        return blob.decode("utf8", "replace")
    p = subprocess.run(
        ["openssl", "enc", "-aes-128-cbc", "-d", "-nopad", "-K", key.hex(), "-iv", (b" " * 16).hex()],
        input=blob[3:], capture_output=True)
    d = p.stdout
    if not d:
        return ""
    d = d[: -d[-1]] if d[-1] <= 16 else d
    if len(d) > 32:  # Chrome 130+ 在明文前加了32字节的域名哈希
        try:
            d.decode("utf8")
        except UnicodeDecodeError:
            d = d[32:]
    return d.decode("utf8", "replace")


def write_env(cookie):
    lines = []
    if os.path.exists(ENV):
        with open(ENV) as f:
            lines = [l.rstrip("\n") for l in f if not l.startswith("BILI_COOKIE=")]
    lines.append(f"BILI_COOKIE={cookie}")
    fd = os.open(ENV, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(ENV, 0o600)


def main():
    blocked = []
    for label, base, service in BROWSERS:
        base = os.path.expanduser(base)
        try:
            os.listdir(base)
        except PermissionError:
            blocked.append(label)
            continue
        except OSError:
            continue
        for db in sorted(glob.glob(base + "/*/Cookies")):
            fd, tmp = tempfile.mkstemp()
            os.close(fd)
            try:
                shutil.copy2(db, tmp)
                rows = sqlite3.connect(tmp).execute(
                    "select name, encrypted_value, value from cookies "
                    "where host_key = '.bilibili.com' and name in (%s)" % ",".join("?" * len(WANT)), WANT).fetchall()
            except PermissionError:
                blocked.append(label)
                continue
            except Exception:
                continue
            finally:
                os.remove(tmp)
            if not any(r[0] == "SESSDATA" for r in rows):
                continue
            key = keychain_key(service)
            got = {}
            for name, enc, plain in rows:
                v = plain or decrypt(enc, key)
                if v and all(32 < ord(c) < 127 and c != ";" for c in v):
                    got[name] = v
            if "SESSDATA" not in got:
                print(f"{label} 里解密 SESSDATA 失败，换下一个浏览器配置")
                continue
            write_env("; ".join(f"{n}={got[n]}" for n in WANT if n in got))
            profile = os.path.basename(os.path.dirname(db))
            print(f"已从 {label}/{profile} 读出 {len(got)} 个 cookie（{'、'.join(n for n in WANT if n in got)}），写入 .env.local")
            return 0
    if blocked:
        print(f"macOS 没有授权读取 {'、'.join(blocked)} 的数据目录（不是登录过期）")
        return 3
    print("没有在浏览器里找到B站登录状态：请先在 Chrome 里登录 bilibili.com 再运行")
    return 1


if __name__ == "__main__":
    sys.exit(main())
