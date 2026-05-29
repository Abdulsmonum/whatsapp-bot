# WhatsApp AI Bot — Railway Deployment Guide
## 100% Free | 24/7 | PC band ho tab bhi chale

---

## PART 1 — Pehli baar local test karo (5 min)

### Step 1 — Folder mein jao
```
cd whatsapp-bot-railway
```

### Step 2 — Packages install karo
```
npm install
```

### Step 3 — bot.js mein Gemini key daalo
Line 14 mein:
```
geminiKey: 'YOUR_GEMINI_API_KEY_HERE'
```
Apni key paste karo.

### Step 4 — Locally chalaao
```
node bot.js
```

### Step 5 — QR scan karo
WhatsApp > 3 dots menu > Linked Devices > Link a Device > QR scan karo

### Step 6 — Test karo
Kisi aur number se apne WhatsApp pe message bhejo.
AI ka reply aana chahiye!

Kaam kar raha hai? Ab Railway pe deploy karo.

---

## PART 2 — Railway pe deploy karo (PC band ho tab bhi chale)

### Step 1 — GitHub pe account banao
github.com pe free account

### Step 2 — New repository banao
- github.com/new
- Name: whatsapp-ai-bot
- Private rakho
- Create repository

### Step 3 — Code upload karo
```
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/AAPKA_USERNAME/whatsapp-ai-bot.git
git push -u origin main
```

### Step 4 — Railway pe deploy karo
- railway.app pe jao
- GitHub se login karo
- "New Project" > "Deploy from GitHub repo"
- Apni repository select karo
- Deploy!

### Step 5 — Gemini Key environment variable mein daalo
Railway Dashboard > Aapka project > Variables tab:
```
GEMINI_KEY = AIzaSy...aapki key...
```
Add karo > Redeploy

### Step 6 — Logs dekho aur QR scan karo
Railway Dashboard > Deployments > Logs
Wahan QR code dikhega — scan karo WhatsApp se

### Step 7 — Done!
Ab 24/7 chal raha hai. PC band karo — bot chalta rahega!

---

## IMPORTANT NOTES

### QR Session
- Ek baar scan karo — auth_info folder mein save ho jata hai
- Railway pe yeh session persist nahi hoga restart pe
- Solution: Railway Volume use karo ya har restart pe dobara scan karo

### Agar ban ho jaye
- Naya WhatsApp Business number use karo
- Personal main number pe risk kam rakhna chahte ho toh

### Reconnection
- Bot automatically reconnect karta hai agar connection toot jaye
- Railway bhi auto-restart karta hai agar crash ho

---

## COST
- Baileys: FREE (open source)
- Gemini API: FREE (1M tokens/day)
- Railway: FREE tier (500 hours/month)
- GitHub: FREE
- Total: $0/month
