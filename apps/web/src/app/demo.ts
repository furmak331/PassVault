import { MemoryStore, Vault } from '@passvaultify/core';
import { DEFAULT_PROFILE, type Profile } from './profile';

export const DEMO_PASSWORD = 'correct horse battery staple';

export const DEMO_PROFILE: Profile = {
  ...DEFAULT_PROFILE,
  name: 'Alex',
  vaultName: "Alex's Vault",
};

/**
 * A realistic vault with problems worth fixing: a reused password, an ancient
 * one, a weak one. It lives in memory only and is gone on reload.
 */
export async function createDemoVault(): Promise<{ vault: Vault; store: MemoryStore }> {
  const store = new MemoryStore();
  // Items are backdated so the vault looks lived-in; after setup the clock is real again.
  let at: Date | null = null;
  const daysAgo = (days: number) => {
    at = new Date(Date.now() - days * 86400_000);
  };
  const { vault } = await Vault.create(store, DEMO_PASSWORD, { now: () => at ?? new Date() });
  daysAgo(700);
  const github = await vault.add({
    type: 'login',
    title: 'GitHub',
    username: 'alex-dev',
    password: 'k7#Tq-v9Rm!2xLp8Wz4e',
    urls: ['https://github.com'],
    tags: ['dev'],
    favorite: true,
  });
  daysAgo(41);
  await vault.update(github.id, { password: 'Hq3$vN9!pLm2#xRt7Kw' });
  daysAgo(420);
  await vault.add({
    type: 'login',
    title: 'GitHub (work)',
    username: 'alex@northwind.test',
    password: 'Summer2024!',
    urls: ['https://github.com'],
    tags: ['work', 'dev'],
  });
  daysAgo(380);
  await vault.add({
    type: 'login',
    title: 'Netflix',
    username: 'alex.family@mail.test',
    password: 'Summer2024!',
    urls: ['https://www.netflix.com'],
    tags: ['streaming'],
  });
  daysAgo(95);
  await vault.add({
    type: 'login',
    title: 'Northwind Bank',
    username: 'alex.m',
    password: 'ribbon-quartz-mango-thistle-orbit',
    urls: ['https://bank.northwind.test'],
    tags: ['finance'],
    favorite: true,
  });
  // MySpace really was created in 2009; this is as far back as the vault remembers.
  daysAgo(1500);
  await vault.add({
    type: 'login',
    title: 'MySpace',
    username: 'xX_alex_Xx',
    password: 'myspace2009',
    urls: ['https://myspace.com'],
    notes: 'Created in 2009. Probably time to close this account.',
  });
  daysAgo(16);
  await vault.add({
    type: 'login',
    title: 'Slice Club Rewards',
    username: 'alex@mail.test',
    password: 'pizza123',
    urls: ['https://slice.test'],
    tags: ['food'],
  });
  daysAgo(230);
  await vault.add({
    type: 'login',
    title: 'Campus Wi-Fi',
    username: 'student-2291',
    password: 'wifi1234',
    tags: ['home'],
  });
  daysAgo(690);
  await vault.add({
    type: 'note',
    title: 'GitHub recovery codes',
    notes: '4f9a1-c2b7e\n8d03f-a61b2\n71ce9-0b4d3\n2a5f8-e9c16',
    tags: ['dev'],
  });
  daysAgo(3);
  await vault.add({
    type: 'note',
    title: 'Home Wi-Fi',
    notes: 'Network: Northwind-5G\nPassword: lantern-cactus-velvet-41',
    tags: ['home'],
  });
  daysAgo(900);
  const old = await vault.add({
    type: 'login',
    title: 'Old forum account',
    username: 'alex',
    password: 'letmein',
  });
  daysAgo(12);
  await vault.moveToTrash(old.id);
  at = null;
  return { vault, store };
}
