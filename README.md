# devresearch-mcp

Hỏi Claude Code về bất kỳ công nghệ nào — nó sẽ đi lùng **Hacker News**, **Reddit**, **Lobsters**, đọc bình luận developer thật, trả lời bạn: **thứ này có thực sự tốt hay chỉ hype?**

## Bạn dùng nó để làm gì

- *"Bun runtime đã production-ready chưa?"* → Claude kéo 20+ thread, tổng hợp: camp ủng hộ nói gì, camp chê cảnh báo gì.
- *"tanstack query v5 có gì mới?"* → lấy discussion 30 ngày gần đây, highlight key voices.
- *"Có gì đang hot trên HN hôm nay?"* → front page snapshot.
- *"User 'jarredsumner' là ai?"* → karma + profile.

Không kéo marketing blog, không kéo tweet. Chỉ forum developer nơi người ta tranh luận thật.

## Cài đặt

**1 lệnh.** Cần Node.js ≥ 20.

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
| `research` | Báo cáo tổng hợp hype-vs-substance về một chủ đề. *(cần API key — xem dưới)* |

Không cần nhớ tên tool — hỏi Claude bằng tiếng Việt/English bình thường, nó tự chọn.

## Bật tool `research` (tùy chọn)

4 tool trên chạy miễn phí, không cần setup gì thêm.

Riêng `research` gọi Claude Haiku để tổng hợp báo cáo — cần Anthropic API key. Nếu không bật, tool vẫn tồn tại nhưng sẽ báo lỗi khi gọi.

**macOS / Linux:**
```bash
claude mcp remove devresearch
claude mcp add devresearch -e ANTHROPIC_API_KEY=sk-ant-... -- npx -y devresearch-mcp
```

**Windows (PowerShell):**
```powershell
claude mcp remove devresearch
claude mcp add devresearch -e ANTHROPIC_API_KEY=sk-ant-... -- npx -y devresearch-mcp
```

Lấy key ở https://console.anthropic.com/ — mỗi research query tốn $0.001–$0.005.

## Cache

Kết quả cache ở `~/.devresearch-mcp/cache.db` (SQLite), TTL 24h. Hỏi lại cùng query trong ngày = instant, miễn phí.

## Giới hạn

- Reddit public JSON endpoint → có rate limit, thi thoảng chậm.
- Clustering trùng discussion dựa trên URL + title — chuẩn với link canonical, yếu với thread text-only.
- `research` gọi LLM 1 lần/query, không self-critique.

## License

MIT
