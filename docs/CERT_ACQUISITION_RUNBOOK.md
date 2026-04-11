# Pan Desktop — code-signing cert acquisition runbook

> ## ⚠ STATUS: ARCHIVED — Pan Desktop ships unsigned indefinitely
>
> This runbook is preserved for historical reference but **not currently
> actionable**. On 2026-04-12 the maintainer decided to ship Pan Desktop
> unsigned indefinitely rather than pay recurring cert fees for a
> pre-1.0 open-source project. The SmartScreen "Unknown publisher" dialog
> is now a permanent part of the install UX, documented in the root
> README's "Windows SmartScreen notice" section.
>
> **If you are considering reactivating this runbook**, note that the
> electron-builder config snippets below use the obsolete `win.sign` +
> `certificateFile` pattern which does not work with the 2023 hardware
> token mandate. Any reactivation must first rewrite Phase 3/4 to use
> SSL.com eSigner + `CodeSignTool` via a `win.signtoolOptions.sign`
> custom hook. See 2026-04-12 research notes for the replacement
> pattern.
>
> **Free alternative considered but not pursued**: SignPath Foundation
> offers free code signing to qualifying OSS projects. Eligibility is
> plausible for Pan Desktop but the application review + SmartScreen
> reputation build still takes 4-6 weeks, and the signing CN would be
> "SignPath Foundation" rather than "Euraika Labs". Not worth the
> coordination overhead for the current user base.

---

## Historical runbook (do not execute without updating first)

This was the checklist for acquiring, installing, and activating a
Windows code-signing certificate. It was written under the original
M1 plan which assumed M1.1 would ship signed. That assumption was
reversed on 2026-04-12.

Pan Desktop ships **unsigned** by deliberate decision. First-run users
hit a SmartScreen "Unknown publisher" warning which they click past.

This was originally framed as a multi-step, multi-day process with
external vendor dependencies — accurate, but no longer urgent.

## TL;DR

- **Recommended vendor:** SSL.com OV cert — cheapest, fastest, Node-friendly
- **Expected cost:** ~$179/year
- **Expected timeline:** 1–5 business days from purchase to cert in hand
- **What you need before purchasing:** phone number, government ID,
  business registration (optional but helps)
- **Where the cert goes after acquisition:** GitHub Actions secrets
  (`WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`)
- **Where to activate it in code:** uncomment the `win.sign` block in
  `electron-builder.yml` and drop the `afterPack.js` Windows no-op

---

## Phase 1 — Choose a cert type

### Option A: OV (Organization Validation) cert — **recommended**

| Attribute | Value |
|---|---|
| SmartScreen bypass | No initially — requires reputation-building |
| Cost | ~$180/year |
| Issuance time | 1–5 business days |
| Storage | Regular `.pfx` file, no hardware |
| GitHub Actions compatible | ✅ yes |
| Good for | M1.1 where we accept first-run SmartScreen + build reputation over time |

**Pros:** cheap, fast, works with existing GitHub Actions workflow.
**Cons:** SmartScreen reputation takes 1–3 weeks of downloads to build up.
During that period, users still see "Unknown publisher" for a fresh cert.

### Option B: EV (Extended Validation) cert

| Attribute | Value |
|---|---|
| SmartScreen bypass | ✅ immediate (from day one) |
| Cost | ~$350–700/year |
| Issuance time | 1–2 weeks |
| Storage | **Hardware token** (YubiKey or similar) — mandatory since 2023 |
| GitHub Actions compatible | ❌ hardware token can't live on a shared runner |
| Good for | Enterprise, no reputation-building needed |

**Pros:** no SmartScreen friction ever.
**Cons:** the hardware token is a real problem for CI. You'd need:
- A self-hosted Windows runner with the token attached, OR
- A signing service like Azure Trusted Signing (see Option C), OR
- Manual signing outside CI (breaks reproducibility)

**Recommendation:** skip EV for M1.1 unless enterprise distribution is
blocking.

### Option C: Azure Trusted Signing

| Attribute | Value |
|---|---|
| SmartScreen bypass | ✅ immediate |
| Cost | $9.99/month (~$120/year) |
| Issuance time | ~1 day for tenant, but subscription eligibility gating |
| Storage | Cloud-based via Azure CLI |
| GitHub Actions compatible | ✅ yes |
| Good for | Teams that already use Azure and want best-of-both-worlds |

**Pros:** cheaper than EV, no hardware token, CI-friendly, SmartScreen bypass.
**Cons:** requires an Azure tenant AND a verifiable business history
(typically 3+ years). **If Euraika Labs doesn't meet the eligibility
criteria, this option is unavailable** — verify with Microsoft before
committing.

### Decision matrix

If you already use Azure and the business is 3+ years old → **Azure Trusted Signing**
Otherwise → **SSL.com OV**

---

## Phase 2 — Prerequisites checklist

Before purchasing an OV cert, have these ready. Missing any of them will
stall the vetting process by days.

- [ ] **Phone number** the vendor can call for verification
      (must match the number of record in public directories)
- [ ] **Government-issued ID** for the certificate owner (passport or
      driver's license, for verification calls)
- [ ] **Business entity details** if representing a company:
      - [ ] Legal business name (must match public records)
      - [ ] Registration number or DUNS number
      - [ ] Registered address
      - [ ] Optional: D-U-N-S number (get free from
            <https://www.dnb.com/duns-number/get-a-duns.html>)
- [ ] **Email address** on a domain the vendor can verify you control
      (not gmail.com — use your euraika.net address)
- [ ] **Credit card** or invoicing arrangement for payment

### If purchasing as an individual (not a company)

Some vendors offer personal OV certs but the publisher display name will
be your legal name, not "Euraika Labs". This changes the SmartScreen
text users see. It also affects `win.publisherName` in
`electron-builder.yml` — the field must match the CN on the cert.

Recommendation: **purchase as Euraika Labs** if the business exists. If
not, go personal with your legal name, and add a comment to
`electron-builder.yml` explaining.

---

## Phase 3 — Vendor-specific runbook (SSL.com OV, recommended)

### Step 1 — Create an SSL.com account

1. Visit <https://www.ssl.com/>
2. Create an account with your euraika.net email
3. Verify your email
4. Add your organization under Account → Organizations

### Step 2 — Purchase the cert

1. Go to Certificates → Code Signing
2. Select "OV Code Signing Certificate"
3. Duration: 1 year is fine for M1.1; renew yearly
4. Purchase

### Step 3 — Fill out the vetting form

1. Complete the vetting questionnaire
2. Upload your ID and business documents
3. SSL.com will call the phone number on file — answer it
4. Expect 1–5 business days; follow up if it stalls

### Step 4 — Generate a Certificate Signing Request (CSR)

When the vetting completes, SSL.com will ask for a CSR. On a secure
machine (ideally a dedicated signing workstation, not your daily driver):

```powershell
# Using openssl on Windows (comes with Git for Windows)
openssl req -new -newkey rsa:3072 -keyout pan-desktop.key -out pan-desktop.csr
```

Answer the prompts:
- Country: `US` (or whichever)
- Organization: **must match the CN that will be on the cert**
- Common Name: `Euraika Labs` (or your legal name if personal)
- Do NOT enter a challenge password (or remember it if you do)

### Step 5 — Submit CSR, receive `.cer`/`.pfx`

1. Paste the CSR contents into SSL.com's portal
2. Wait for issuance (usually minutes after CSR submission)
3. Download the issued cert
4. Convert to `.pfx` (PKCS#12) if you received a `.cer`:

```powershell
openssl pkcs12 -export -out pan-desktop.pfx -inkey pan-desktop.key -in pan-desktop.cer
```

Set a strong password when prompted. **Save this password** — you'll
paste it into GitHub Actions secrets.

### Step 6 — Store the cert securely

- **DO NOT** commit `pan-desktop.pfx` to any git repo
- **DO NOT** email it
- Store in 1Password, Bitwarden, or similar
- Also store the .pfx password in the same vault
- Set a calendar reminder 30 days before the cert's expiration date

---

## Phase 4 — GitHub Actions wiring

### Step 1 — Encode the .pfx for GitHub Actions

GitHub Actions secrets are strings. Base64-encode the `.pfx`:

```powershell
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("pan-desktop.pfx"))
$b64 | Set-Clipboard
# Now paste into GitHub secret
```

### Step 2 — Add secrets to `Euraika-Labs/pan-desktop`

Via the GitHub UI:
1. Settings → Secrets and variables → Actions → New repository secret
2. Name: `WIN_CSC_LINK`, Value: (paste base64 from above)
3. New secret: Name: `WIN_CSC_KEY_PASSWORD`, Value: (the password you set in Step 5)

### Step 3 — Update `electron-builder.yml`

Uncomment the `win.sign` scaffold in `electron-builder.yml`. The block
was left in place during M1 as a scaffold — it currently looks like:

```yaml
win:
  executableName: pan-desktop
  # Code signing scaffold — activated in M1.1 when cert is acquired.
  # sign:
  #   certificateFile: ${env.WIN_CSC_LINK}
  #   certificatePassword: ${env.WIN_CSC_KEY_PASSWORD}
  #   signingHashAlgorithms: [sha256]
  #   rfc3161TimeStampServer: http://timestamp.digicert.com
  # publisherName: Euraika Labs
```

Uncomment and fill in `publisherName` to exactly match the CN on your
cert (i.e. the value you entered in the CSR Common Name field). If the
strings don't match, electron-builder refuses to sign.

### Step 4 — Update `build/afterPack.js`

The Windows branch of `afterPack.js` is currently a no-op stub (see
comment in the file). For signing via electron-builder's built-in
signtool integration, the no-op stays — electron-builder signs the
binary during the `--win` build itself, not in afterPack.

If you want custom post-signing (e.g. signing individual DLLs), add the
logic inside the `if (platform === "win32")` block.

### Step 5 — Test signing in a release branch

1. Create `release/m1.1-signed-test` from develop
2. Push a tag: `git tag v0.0.2-signed-test`
3. Trigger the release workflow
4. Verify the produced `.exe` is signed:
   ```powershell
   Get-AuthenticodeSignature pan-desktop-0.0.2-signed-test-setup.exe
   ```
   Status should be `Valid`.
5. Download the signed installer on a Windows VM
6. Run it — SmartScreen should show "Euraika Labs" as the publisher
   (may still say "Unknown" for OV certs until reputation builds)

### Step 6 — Cut a real signed release

Once the test signed build works:
1. Bump version in `package.json`
2. Cut a release branch
3. Run the release workflow
4. Distribute the signed installer
5. Monitor feedback on SmartScreen behavior over the first week

---

## Phase 5 — SmartScreen reputation building (OV only)

With an OV cert, Windows SmartScreen still shows "Unknown publisher"
for new certs until the cert has accumulated enough download volume.
This is NOT a bug — it's intentional anti-malware heuristic.

### How to build reputation faster

- Ship to as many users as possible early
- Ask users to click "More info → Run anyway" (each click builds rep)
- Submit the cert to Microsoft's SmartScreen whitelist:
  <https://www.microsoft.com/en-us/wdsi/filesubmission>
- Wait 1–3 weeks

Once reputation is established, the "Unknown publisher" banner goes
away automatically. Microsoft does not publish the threshold.

---

## Phase 6 — Ongoing maintenance

### Expiration monitoring

- Calendar reminder 30 days before cert expires
- Budget for renewal in yearly planning
- Test the renewed cert before swapping it into GitHub secrets

### Key rotation

If the `.pfx` is ever compromised:
1. Revoke immediately via SSL.com portal
2. Acquire a new cert
3. Update GitHub secrets
4. Cut a new release with the new signing

### Publisher name stability

**Never change `publisherName`** without warning. Changing it:
- Resets SmartScreen reputation to zero
- Confuses existing users who will see a "new" publisher
- Invalidates any allowlist entries enterprises may have for the current name

---

## Deferred decisions (revisit when cert arrives)

- Whether to also sign individual DLLs inside ASAR (probably not — most
  Electron apps don't)
- Whether to add a timestamp server fallback (yes, at minimum DigiCert +
  Sectigo so outages don't break CI)
- Whether to enable cert pinning in electron-updater
