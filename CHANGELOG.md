## [0.0.2](https://git.euraika.net/euraika/pan-desktop/compare/v0.0.1...v0.0.2) (2026-04-12)


### Bug Fixes

* **ci:** allow api + web triggers so auto_back_merge is testable ([4f0e44c](https://git.euraika.net/euraika/pan-desktop/commits/4f0e44c43661755a92b904f7a63b0bf6749f0938))
* **m1.1-#004:** force Crashpad capture for uncaught JS exceptions ([cda5824](https://git.euraika.net/euraika/pan-desktop/commits/cda58241de503570ca4d73b79eeffe1231bb1b77)), closes [m1.1-#004](https://git.euraika.net/m1.1-/issues/004) [#27602](https://git.euraika.net/euraika/pan-desktop/issues/27602)
* migrate release URL to pan-desktop.euraika.net custom domain ([9e6ec3b](https://git.euraika.net/euraika/pan-desktop/commits/9e6ec3bfa88c7e421994cb2b00327bb551e86f4d))
* point electron-updater at the actual GitLab Pages URL ([31df80e](https://git.euraika.net/euraika/pan-desktop/commits/31df80eda2453ce32281e2a953812357f4795958))
* **wave1:** address code review findings + Windows CI failures ([fd1302c](https://git.euraika.net/euraika/pan-desktop/commits/fd1302c8eed9bab57b37a012ddb579612d60c36c)), closes [#1](https://git.euraika.net/euraika/pan-desktop/issues/1) [#2](https://git.euraika.net/euraika/pan-desktop/issues/2) [#3](https://git.euraika.net/euraika/pan-desktop/issues/3) [#4](https://git.euraika.net/euraika/pan-desktop/issues/4) [#5](https://git.euraika.net/euraika/pan-desktop/issues/5) [#8](https://git.euraika.net/euraika/pan-desktop/issues/8) [#1](https://git.euraika.net/euraika/pan-desktop/issues/1)
* **wave4:** address review findings — cache race + venvBinDir duplication ([c62dc2c](https://git.euraika.net/euraika/pan-desktop/commits/c62dc2cba4f938989ca0b344f1283b4037020e23)), closes [#1](https://git.euraika.net/euraika/pan-desktop/issues/1) [#2](https://git.euraika.net/euraika/pan-desktop/issues/2) [#3](https://git.euraika.net/euraika/pan-desktop/issues/3) [#4](https://git.euraika.net/euraika/pan-desktop/issues/4) [#5](https://git.euraika.net/euraika/pan-desktop/issues/5) [#6](https://git.euraika.net/euraika/pan-desktop/issues/6) [#7](https://git.euraika.net/euraika/pan-desktop/issues/7) [#8](https://git.euraika.net/euraika/pan-desktop/issues/8) [#9](https://git.euraika.net/euraika/pan-desktop/issues/9) [#10](https://git.euraika.net/euraika/pan-desktop/issues/10) [#11](https://git.euraika.net/euraika/pan-desktop/issues/11) [#12](https://git.euraika.net/euraika/pan-desktop/issues/12) [#13](https://git.euraika.net/euraika/pan-desktop/issues/13) [#14](https://git.euraika.net/euraika/pan-desktop/issues/14) [#15](https://git.euraika.net/euraika/pan-desktop/issues/15) [#16](https://git.euraika.net/euraika/pan-desktop/issues/16) [#17](https://git.euraika.net/euraika/pan-desktop/issues/17) [#17](https://git.euraika.net/euraika/pan-desktop/issues/17) [#15](https://git.euraika.net/euraika/pan-desktop/issues/15)


### Features

* **ci:** Wave 4 — pages release channel + Linux build on tags ([adee414](https://git.euraika.net/euraika/pan-desktop/commits/adee41476f047fff6c124f5983f976cc09221213))
* **install:** pin upstream via -Ref param; regen install.ps1 hash ([d6178e7](https://git.euraika.net/euraika/pan-desktop/commits/d6178e7c1541eb08bddec57f1831b6f0d1725f18)), closes [M1.1-#008](https://git.euraika.net/M1.1-/issues/008)
* **m1.1-#002:** wire auto-update via github provider on mirror ([566bc5e](https://git.euraika.net/euraika/pan-desktop/commits/566bc5e7e4a1a019b43755291978c7c79f89ed0c)), closes [m1.1-#002](https://git.euraika.net/m1.1-/issues/002)
* **m1.1-#005:** SHA256 integrity check for vendored install.ps1 ([5126738](https://git.euraika.net/euraika/pan-desktop/commits/51267384fad709e56cb63953322b87135a160cbb)), closes [m1.1-#005](https://git.euraika.net/m1.1-/issues/005) [M1.1-#001](https://git.euraika.net/M1.1-/issues/001) [M1.1-#001](https://git.euraika.net/M1.1-/issues/001)
* **m1.1-#008+#009:** post-install Python overlay mechanism + 3 patches ([8e25fee](https://git.euraika.net/euraika/pan-desktop/commits/8e25fee98393bd2ce2ffd42706a932dc10babf09)), closes [#009](https://git.euraika.net/euraika/pan-desktop/issues/009) [M1.1-#008](https://git.euraika.net/M1.1-/issues/008)
* M2 platform hardening — IPC channels, Regolo provider, portable build ([9b73f16](https://git.euraika.net/euraika/pan-desktop/commits/9b73f16d02830c8fae2a3ad0ebf75f4cc84e6cbd))
* **wave1:** platformAdapter + processRunner + runtimePaths + desktopPaths ([c65451f](https://git.euraika.net/euraika/pan-desktop/commits/c65451fdc8995eeb62ef7c49c005a388dfe0603d))
* **wave2+3:** migrate all services onto platform/runtime abstractions ([a2e0ba3](https://git.euraika.net/euraika/pan-desktop/commits/a2e0ba31e0b3bdba8cfd1a53b841e684f2d5ad85))
* **wave4:** runtimeInstaller + runtimeUpdate + runtimeManifest + smoke harness + cert runbook ([8f73b5a](https://git.euraika.net/euraika/pan-desktop/commits/8f73b5a3a56db604c872dc3f3e763f0abff76427))
* **waves-5-9:** M1 Windows readiness — install, packaging, safety, upstream ([4ce7f20](https://git.euraika.net/euraika/pan-desktop/commits/4ce7f2085334bfd7c50f9e1957de978e67ff4dbd)), closes [M1.1-#008](https://git.euraika.net/M1.1-/issues/008) [M1.1-#009](https://git.euraika.net/M1.1-/issues/009) [M1.1-#001](https://git.euraika.net/M1.1-/issues/001) [M1.1-#010](https://git.euraika.net/M1.1-/issues/010)

## 0.0.1 (2026-04-11)
