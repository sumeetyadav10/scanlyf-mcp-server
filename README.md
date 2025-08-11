# Scanlyf 🍎

A smart nutrition tracking API that actually gets how Indians eat. No more "100g ...." coz more that the quantity its about the quality.

## What is this?

NOT A COPY of Cal AI had this idea for months now, for now it's an MCP server that tracks what you eat, tells you if it's bad for you, and even spots sketchy ingredients in packaged foods AND MANY MORE...

## Quick Start

```bash
# Clone it
git clone https://github.com/yourusername/scanlyf.git
cd scanlyf

# Install stuff
npm install

# Set up your .env (check .env.example)
cp .env.example .env

# Run it
npm start
```

## Features that actually work

- **Food Scanning**: Upload a photo, get nutrition info. Works with Indian food too.
- **Barcode Scanner**: Scans barcodes and tells you what's actually in that packet of chips
- **Health Warnings**: If you have diabetes and scan a ladoo, it'll warn you
- **Weekly Reports**: AI-generated analysis of your eating habits (sounds fancy, is actually useful)

## How to use it

Head to [scanlyf.com/start](https://scanlyf.com/start) for the full guide. But basically:

1. Connect with Puch AI (it's like a WhatsApp for health apps)
2. Upload food pics or type what you ate
3. Get nutrition info and health warnings
4. Check your progress anytime
5. See what you ate today (with a list command)
6. Remove stuff if you logged it wrong

## Tech Stack

- Node.js + Express (backend)
- Firebase (database)
- Google Vision API (food detection)
- OpenAI (for the smart recommendations)

## API Endpoints

Main endpoint: `POST /mcp`

Tools available:
- `scan_and_add_food` - Scan and log food in one go
- `add_food` - Log food manually
- `get_progress` - Check daily intake
- `list_today_foods` - See everything you ate today with nutrients
- `remove_food` - Delete something you logged by mistake
- `get_weekly_analysis` - Get AI insights

## Running locally

```bash
# Development mode
npm run dev

# Production
NODE_ENV=production npm start
```

## Contributing

Found a bug? Food not detecting properly? Open an issue or send a PR. Just keep it simple.

## License

MIT - Do whatever you want with it

---

Made with ☕ and way too many late nights by a stressed engineering student who just wanted to track his meals properly.