# Merged IP API

Vercel par deploy karne ke liye simple API. Is API me FreeIPAPI aur IPQuery dono ka response ek saath milta hai.

## Deploy

1. Is folder ko GitHub repository ya Vercel me upload karo.
2. Vercel me **Deploy** select karo.
3. Koi API key ya environment variable required nahi hai.

## Endpoint

```text
GET /api/ip
GET /api/ip?ip=8.8.8.8
```

## Response me kya milega

- Location: country, city, region, coordinates
- Timezone, currencies aur languages
- ASN, organization aur ISP
- VPN, Tor, proxy aur datacenter status
- `sources.freeipapi` me FreeIPAPI ka data
- `sources.ipquery` me IPQuery ka data

Domain field response me intentionally nahi bheji jaati.