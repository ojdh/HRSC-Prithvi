'use client';

import {useEffect, useState} from 'react';
import {Download, Share, Smartphone, WifiOff} from 'lucide-react';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger} from '@/components/ui/dialog';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
};

export default function PhoneApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>('desktop');
  const [offline, setOffline] = useState(false);
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)');
    const updateDisplay = () => setInstalled(display.matches || Boolean((navigator as Navigator & {standalone?: boolean}).standalone));
    const updateNetwork = () => setOffline(!navigator.onLine);
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const complete = () => { setInstalled(true); setPrompt(null); setOpen(false); };
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setPlatform(ios ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'desktop');
    updateDisplay(); updateNetwork();
    display.addEventListener('change', updateDisplay);
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', complete);
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    if ('serviceWorker' in navigator && window.isSecureContext) {
      // Only the public reconnect page is cached. Authentication, votes and
      // player records always go to the server.
      navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'}).catch(() => {});
    }
    return () => {
      display.removeEventListener('change', updateDisplay);
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', complete);
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
    };
  }, []);

  async function install() {
    if (!prompt || installing) return;
    setInstalling(true); setMessage('');
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setOpen(false);
      else setMessage('You can install it later from your browser menu.');
    } catch { setMessage('Use your browser menu to install the app.'); }
    finally { setPrompt(null); setInstalling(false); }
  }

  return <div className="phone-app-tools">
    {offline && <span className="phone-offline" role="status"><WifiOff size={16}/><span>Offline · reconnect to save or vote</span></span>}
    {!installed && <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><button className="phone-install" aria-label="Install Prithvi FC app"><Smartphone size={18}/><span>Install app</span></button></DialogTrigger>
      <DialogContent className="dialog-panel phone-install-dialog">
        <div className="phone-app-heading"><img src="/icons/icon-192.png" width="64" height="64" alt=""/><span>PRITHVI FC</span></div>
        <DialogHeader><DialogTitle>One tap to your club.</DialogTitle><DialogDescription>Add Prithvi FC to your home screen.</DialogDescription></DialogHeader>
        {platform === 'ios' ? <ol className="phone-install-steps">
          <li>Open this website in <strong>Safari</strong>.</li>
          <li>Tap <Share size={16} aria-hidden="true"/> <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li>
          <li>Keep <strong>Open as Web App</strong> enabled if shown, then tap <strong>Add</strong>.</li>
        </ol> : prompt ? <button className="primary-btn phone-install-primary" disabled={installing || offline} onClick={install}><Download size={18}/>{installing ? 'Opening…' : 'Install Prithvi FC'}</button> : <ol className="phone-install-steps">
          {platform === 'android' ? <><li>Open this website in <strong>Chrome</strong>.</li><li>Tap the <strong>⋮ menu</strong>, then <strong>Add to Home screen</strong> or <strong>Install app</strong>.</li><li>Confirm <strong>Install</strong> or <strong>Add</strong>.</li></> : <><li>Open this website in <strong>Chrome, Edge or Safari</strong>.</li><li>Use <strong>Install app</strong> in the browser menu or address bar. In Safari on Mac, choose <strong>File → Add to Dock</strong>.</li></>}
        </ol>}
        {message && <p className="phone-install-note" role="status">{message}</p>}
        <p className="phone-install-note">Use your existing account. Scores and voting need an internet connection.</p>
      </DialogContent>
    </Dialog>}
  </div>;
}
