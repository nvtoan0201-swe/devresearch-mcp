# devresearch-mcp

Hỏi Claude về một công nghệ, framework, hay chủ đề lập trình — nó sẽ đi lùng **Hacker News**, **Reddit**, **Lobsters**, đọc bình luận thật của developer, rồi trả lời bạn: **thứ này có thực sự tốt hay chỉ hype?**

## Bạn dùng nó để làm gì

- *"Bun runtime đã production-ready chưa?"* → Claude kéo 20+ thread, phân tích, trả bạn: camp ủng hộ nói gì, camp phản đối cảnh báo gì, hype score bao nhiêu.
- *"Rust async traits 2026 còn ai dùng không?"* → nhìn qua discussion 60 ngày gần đây, điểm engagement của expert, tổng hợp quan điểm.
- *"Có gì đang hot trên HN hôm nay?"* → xem front page + hot posts.
- *"User 'jarredsumner' bên HN là ai, karma thế nào?"* → profile summary.

Nó **không** kéo marketing blog, không kéo tweet. Chỉ các forum developer nơi người ta tranh luận thật.

## Cài đặt

Cần **Node.js ≥ 20** và **Anthropic API key** (cho tool `research`).

### macOS / Linux

```bash
# Lấy API key từ https://console.anthropic.com/
export ANTHROPIC_API_KEY="sk-ant-..."

# Thêm dòng trên vào ~/.zshrc hoặc ~/.bashrc để nó bền
```

Mở file config Claude Code (`~/.config/claude/claude_desktop_config.json` hoặc `.mcp.json` trong project):

```json
{
  "mcpServers": {
    "devresearch": {
      "command": "npx",
      "args": ["-y", "devresearch-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

### Windows (PowerShell)

```powershell
# Set API key trong user environment (bền sau reboot)
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "sk-ant-...", "User")

# Reload session hoặc mở PowerShell mới để nhận biến mới
```

Mở file config Claude Code (`%APPDATA%\Claude\claude_desktop_config.json` hoặc `.mcp.json` trong project):

```json
{
  "mcpServers": {
    "devresearch": {
      "command": "npx",
      "args": ["-y", "devresearch-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

### Kiểm tra

Restart Claude Code. Gõ thử:

> *"Dùng devresearch research về tanstack query v5"*

Nếu Claude gọi tool và trả kết quả — xong.

## Các tool có sẵn

| Tool | Khi nào dùng |
|---|---|
| `research` | Muốn báo cáo tổng hợp về một chủ đề (hype vs substance, pros/cons, misconceptions). **Cần API key.** |
| `search` | Tìm discussion theo keyword, trả link + score trên cả 3 platform. |
| `trending` | Xem gì đang hot trên front page / r/hot / hottest. |
| `get_post` | Đọc sâu một thread cụ thể kèm comment tree. |
| `get_user` | Xem karma / profile của user. |

Bạn **không** cần nhớ tên tool — cứ hỏi Claude bằng ngôn ngữ bình thường, nó tự chọn.

## Cấu hình (tùy chọn)

Mặc định đã chạy tốt. Nếu muốn tinh chỉnh — tạo `~/.devresearch-mcp/config.toml`:

```toml
[sources.reddit]
subreddits = ["programming", "rust", "LocalLLaMA", "webdev"]

[llm]
model = "claude-haiku-4-5"      # nhanh + rẻ, mặc định
temperature = 0.2

[hype_scoring]
buzzwords = ["game changer", "revolutionary", "next-gen"]
```

Đổi path config bằng env `DEVRESEARCH_CONFIG=/đường/dẫn/khác.toml`.

## Chi phí

- `search` / `trending` / `get_post` / `get_user`: **miễn phí** — chỉ gọi API public của HN/Reddit/Lobsters.
- `research`: **1 lần gọi Claude Haiku** mỗi câu hỏi — khoảng $0.001–$0.005. Rẻ.

Cache SQLite ở `~/.devresearch-mcp/cache.db` giữ lại kết quả 24h, tránh gọi lại.

## Giới hạn

- Reddit dùng JSON endpoint public — có rate limit, thi thoảng chậm.
- Clustering trùng lặp dựa trên URL + title — chính xác với link canonical, yếu với thread chỉ có text title.
- `research` gọi LLM **1 lần** mỗi query — không self-critique, không lặp. Đủ dùng, rẻ.

## License

MIT
