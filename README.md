# devresearch-mcp

Hỏi Claude Code về bất kỳ công nghệ nào — nó sẽ đi lùng **Hacker News**, **Reddit**, **Lobsters**, đọc bình luận developer thật, trả lời bạn: **thứ này có thực sự tốt hay chỉ hype?**

## Bạn dùng nó để làm gì

- *"Bun runtime đã production-ready chưa?"* → Claude kéo 20+ thread, tổng hợp: camp ủng hộ nói gì, camp chê cảnh báo gì.
- *"tanstack query v5 có gì mới?"* → lấy discussion 30 ngày gần đây, highlight key voices.
- *"Có gì đang hot trên HN hôm nay?"* → front page snapshot.
- *"User 'jarredsumner' là ai?"* → karma + profile.

Không kéo marketing blog, không kéo tweet. Chỉ forum developer nơi người ta tranh luận thật.

## Cài đặt

**1 lệnh.** Cần Node.js ≥ 20. **Không cần API key, không cần config.**

```bash
claude mcp add devresearch -- npx -y devresearch-mcp
```

Xong. Restart Claude Code, hỏi thử:

> *"Dùng devresearch xem gì đang hot trên HN"*

## Các tool

| Tool | Khi nào dùng |
|---|---|
| `search` | Tìm discussion theo keyword trên cả 3 platform. |
| `trending` | Xem gì đang hot front page / r/hot / hottest. |
| `get_post` | Đọc sâu một thread kèm comment tree. |
| `get_user` | Xem karma / profile của user. |
| `research` | Gom top discussion + chấm điểm heuristic (velocity, buzzword density, expert engagement…) — Claude tự viết báo cáo hype-vs-substance từ data đó. |

Không cần nhớ tên tool — hỏi Claude bằng tiếng Việt/English bình thường, nó tự chọn.

## Cache

Kết quả cache ở `~/.devresearch-mcp/cache.db` (SQLite), TTL 24h. Hỏi lại cùng query trong ngày = instant.

## Cấu hình (tùy chọn)

Mặc định chạy tốt. Muốn tinh chỉnh thì tạo `~/.devresearch-mcp/config.toml`:

```toml
[sources.reddit]
subreddits = ["programming", "rust", "LocalLLaMA", "webdev"]

[cache]
ttl_hours = 24

[hype_scoring]
buzzwords = ["game changer", "revolutionary", "next-gen"]
```

Override path: `DEVRESEARCH_CONFIG=/đường/dẫn/khác.toml`.

## Giới hạn

- Reddit public JSON endpoint → có rate limit, thi thoảng chậm.
- Clustering trùng discussion dựa trên URL + title — chuẩn với link canonical, yếu với thread text-only.
- `research` trả top 6 post (hoặc 12 với `depth: "deep"`) — đủ dùng, không quá tải context.

## License

MIT
