"use client";

import { Navbar } from "../components/Navbar";
import WalletAccountV6Tag from "../components/client/WalletHandle/WalletAccountV6Tag";

// Not linked from anywhere on the main site on purpose - this is the
// operator's tool for driving the STRK20 pool directly (shield the safe
// wallet's accumulated balance, pay out pending claims privately), not
// something a regular visitor needs to see.
export default function PayPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-ls-black">
      <Navbar />
      <div className="pt-32 pb-24">
        <div className="section-container">
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-ls-gray-400 mb-3">
              Operator
            </p>
            <h1 className="text-3xl font-bold text-black dark:text-white mb-3">
              STRK20 pool
            </h1>
            <p className="text-ls-gray-500 dark:text-ls-gray-400 max-w-xl mx-auto">
              Connect the safe wallet to shield its accumulated balance and
              pay out pending claims privately.
            </p>
          </div>
          <div className="max-w-md mx-auto">
            <WalletAccountV6Tag />
          </div>
        </div>
      </div>
    </div>
  );
}
