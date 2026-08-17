"use client";

import styles from './uni.module.css';
import SelectWallet from './components/client/WalletHandle/SelectWallet';
import WalletAccountV6Tag from './components/client/WalletHandle/WalletAccountV6Tag';
import ConnectGithub from './components/client/GithubHandle/ConnectGithub';

export default function Page() {
  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tokens/strk20.png" alt="STRK20" className={styles.brandImg} />
        </div>
        <div className={styles.navActions}>
          <ConnectGithub />
          <SelectWallet variant="nav" />
        </div>
      </nav>

      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>
          Aegis
          <br />
          <span className={styles.heroAccent}>Whitehat Rescue</span>
        </h1>
        <p className={styles.heroSub}>
          Leaked a key? We sweep exposed funds into the STRK20 shielded pool
          before an attacker can, and return them once you prove you own the repo.
        </p>
      </header>

      <main>
        <WalletAccountV6Tag />
      </main>

      <footer className={styles.footer}>
        <a href="https://github.com/justbiar/aegis" target="_blank" rel="noreferrer">
          Repo
        </a>
        <span className={styles.footerDot}>·</span>
        <span>Powered by Starknet.js v10.4.0</span>
      </footer>
    </div>
  );
}
