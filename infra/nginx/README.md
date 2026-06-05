# BPA Nginx — Production Config

```
infra/nginx/
├── conf.d/
│   ├── 00-map-upgrade.conf      # WebSocket map (http context)
│   ├── 00-upstreams.conf        # bpa_landing :3101, bpa_vaccination :3110
│   ├── 01-rate-limit.conf       # limit_req / limit_conn zones
│   ├── 02-security-headers.conf # server_tokens off
│   ├── 03-compression.conf      # gzip
│   └── 04-brotli.conf           # optional — disable if module missing
├── snippets/
│   ├── ssl-letsencrypt.conf
│   ├── security-headers.conf
│   ├── proxy-nextjs.conf
│   └── proxy-api.conf
├── sites-available/
│   ├── 00-acme-and-redirect.conf
│   ├── bangladeshpetassociation.com.conf
│   └── vaccination.bangladeshpetassociation.com.conf
└── nginx.conf.patch             # merge notes for main nginx.conf
```

**Full deployment guide:** [docs/nginx-production-deployment.md](../../docs/nginx-production-deployment.md)  
**Port & domain matrix:** [docs/infrastructure/PORT_AND_DOMAIN_MAP.md](../../docs/infrastructure/PORT_AND_DOMAIN_MAP.md)

## Quick install

```bash
sudo cp conf.d/*.conf /etc/nginx/conf.d/
sudo cp snippets/*.conf /etc/nginx/snippets/
sudo cp sites-available/*.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/00-acme-and-redirect.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/bangladeshpetassociation.com.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/vaccination.bangladeshpetassociation.com.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```
