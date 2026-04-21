# devresearch-mcp

Claude Code đọc developer forum giùm bạn.

Bạn hỏi *"framework X có đáng dùng không?"* — thay vì Claude đoán từ training data cũ, nó đi đọc **Hacker News**, **Reddit**, **Lobsters** ngay lúc đó, xem developer thật đang nói gì, rồi trả lời.

---

## Cài đặt

```bash
claude mcp add devresearch -- npx -y devresearch-mcp
```

Cần Node.js ≥ 20. Không cần API key. Không cần config.

Restart Claude Code là dùng được.

---

## Thử ngay

Hỏi Claude:

> *"Dùng devresearch xem Bun runtime có production-ready chưa"*

Claude sẽ:
1. Tìm discussion về Bun trên HN + Reddit + Lobsters (30 ngày gần đây)
2. Đọc top 6 thread — cả bài viết lẫn comment
3. Chấm điểm heuristic: độ hype, expert engagement, tỷ lệ bất đồng, buzzword density
4. Tóm tắt: "Có 34 discussion. Camp ủng hộ nói speed; camp phản đối lo native modules. Expert engagement cao (62%), buzzword thấp → substantive, ít hype."

---

## Những gì nó làm được

| Bạn hỏi | Tool được dùng |
|---|---|
| *"Tanstack query v5 có gì thay đổi?"* | `research` — tổng hợp + chấm hype |
| *"Search HN về WebAssembly"* | `search` — list discussion theo keyword |
| *"HN hôm nay có gì hot?"* | `trending` — front page snapshot |
| *"Mở thread HN id 42 cho tôi"* | `get_post` — đọc sâu kèm comment tree |
| *"User jarredsumner karma bao nhiêu?"* | `get_user` — profile + karma |

Bạn không cần nhớ tên tool. Hỏi bằng ngôn ngữ bình thường, Claude tự chọn.

---

## Cách nó nhận biết hype

Mỗi post được chấm 6 điểm local (không gọi LLM):

- **velocity** — điểm tăng nhanh như thế nào theo thời gian
- **buzzword density** — mật độ từ marketing ("revolutionary", "10x", "game-changer"...)
- **expert engagement** — tỉ lệ comment từ user karma cao
- **dissent** — tỉ lệ comment phản đối
- **depth** — độ sâu comment tree (càng sâu → càng nhiều tranh luận kỹ thuật)
- **longevity** — discussion sống bao lâu sau khi post

Quy luật:
- Buzzword cao + velocity cao + expert thấp → **strong_hype**
- Buzzword thấp + expert cao → **substantive**
- Còn lại → **balanced** hoặc **mild_hype**

---

## Cache

Kết quả cache SQLite ở `~/.devresearch-mcp/cache.db`, TTL 24h. Hỏi lại cùng query trong ngày = instant.

---

## Cấu hình (không bắt buộc)

Tạo `~/.devresearch-mcp/config.toml` nếu muốn đổi:

```toml
[sources.reddit]
subreddits = ["programming", "rust", "LocalLLaMA"]

[hype_scoring]
buzzwords = ["game changer", "revolutionary", "next-gen"]
```

Đổi path config: `DEVRESEARCH_CONFIG=/path/to/file.toml`.

---

## Giới hạn

- Reddit dùng public JSON → có rate limit.
- Clustering duplicate dựa URL + title — chuẩn với link canonical, yếu với thread text-only.
- Mỗi query `research` trả tối đa 12 post (`depth: "deep"`) hoặc 6 (mặc định).

---

MIT © 2026
