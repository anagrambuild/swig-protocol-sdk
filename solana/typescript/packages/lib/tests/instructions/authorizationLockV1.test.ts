/**
 * Tests for AddAuthorizationLockV1 / RemoveAuthorizationLockV1 encoding
 *
 * Expected bytes and account metas were produced by the Rust builders in
 * swig-wallet `interface/src/lib.rs` (`AddAuthorizationLockV1Instruction`,
 * `RemoveAuthorizationLockV1Instruction`) for the same inputs.
 */

import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { SystemProgram } from '@solana/web3.js';
import {
  getAddAuthorizationLockV1InstructionDataCodec,
  getRemoveAuthorizationLockV1InstructionDataCodec,
  identifySwigInstruction,
  SwigInstructionDiscriminator,
} from '@swig-wallet/coder';
import {
  Actions,
  createEd25519AuthorityInfo,
  createEd25519SessionAuthorityInfo,
  Ed25519Instruction,
  findSwigPdaRaw,
  getAddSolAuthorizationLockInstructionContext,
  getAddTokenAuthorizationLockInstructionContext,
  getCreateSessionInstructionContext,
  getCreateSwigInstructionContext,
  getRemoveAuthorizationLockInstructionContext,
  getSwigWalletAddressRaw,
  Secp256k1Instruction,
  SolInstruction,
  SolPublicKey,
} from '../../src';
import {
  fetchSwig,
  getFundedKeys,
  getSvm,
  getSvmWithTestProgram,
} from '../context';
import {
  createTestProgramExecAuthority,
  createTestSecp256k1Authority,
  createTestSecp256r1Authority,
} from '../fixtures/authorities';
import {
  createTestProgramPreInstruction,
  generateTestKeypair,
  randomBytes,
  sendSVMTransaction,
  sendSwigSVMTransaction,
  toPublicKey,
} from '../helpers';

const pk = (byte: number) => new SolPublicKey(new Uint8Array(32).fill(byte));

const swig = pk(1);
const payer = pk(2);
const authority = pk(3);
const wallet = pk(4);
const tokenAccount = pk(5);
const mint = pk(6);
const rentClaimer = pk(7);

const SYSTEM_PROGRAM = '11111111111111111111111111111111';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

function metas(ix: SolInstruction) {
  return ix.accounts.map((a) => [a.publicKey.toBase58(), a.writable, a.signer]);
}

const constantSigningFn = async () => ({
  signature: new Uint8Array(65).fill(0x11),
});

describe('AuthorizationLockV1 instructions', () => {
  test('adds and removes a SOL lock against the pinned program', async () => {
    const svm = getSvm();
    const [root] = getFundedKeys(svm, 1);
    const recipient = generateTestKeypair();
    svm.airdrop(recipient.publicKey, 1_000_000n);
    const transfer = SolInstruction.from(
      SystemProgram.transfer({
        fromPubkey: root.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 1,
      }),
    );
    const options = {
      preInstructions: [transfer],
      postInstructions: [transfer],
    };
    const swigId = randomBytes(32);
    const [swigAddress] = await findSwigPdaRaw(swigId);
    const create = await getCreateSwigInstructionContext({
      authorityInfo: createEd25519AuthorityInfo(root.publicKey),
      id: swigId,
      payer: root.publicKey,
      actions: Actions.set()
        .all()
        .manageAuthorizationLocks({ maxDurationSlots: 100n })
        .get(),
    });
    sendSwigSVMTransaction(svm, create, root);

    let swig = fetchSwig(svm, swigAddress);
    const walletAddress = toPublicKey(await getSwigWalletAddressRaw(swig));
    svm.airdrop(walletAddress, 2_000_000_000n);
    const roleId = swig.roles[0].id;
    const currentSlot = BigInt(svm.getClock().slot);
    const add = await getAddSolAuthorizationLockInstructionContext(
      swig,
      roleId,
      {
        amount: 1_000_000_000n,
        expirySlot: currentSlot + 100n,
      },
      options,
    );
    sendSwigSVMTransaction(svm, add, root);

    swig = fetchSwig(svm, swigAddress);
    expect(swig.authorizationLocks().nextLockId).toBe(1);
    expect(swig.authorizationLocks().locks).toMatchObject([
      { amount: 1_000_000_000n, roleId, lockId: 0 },
    ]);
    expect(swig.activeAuthorizationLocks(currentSlot).length).toBe(1);

    const invalidRemove = await getRemoveAuthorizationLockInstructionContext(
      swig,
      roleId,
      { lockId: 99 },
    );
    // The pinned program reports AuthorizationLockNotFound as custom error 86.
    expect(() => sendSwigSVMTransaction(svm, invalidRemove, root)).toThrow(
      'InstructionErrorCustom { code: 86 }',
    );
    expect(fetchSwig(svm, swigAddress).authorizationLocks()).toEqual(
      swig.authorizationLocks(),
    );

    const remove = await getRemoveAuthorizationLockInstructionContext(
      swig,
      roleId,
      { lockId: 0 },
      options,
    );
    sendSwigSVMTransaction(svm, remove, root);
    expect(svm.getAccount(recipient.publicKey)?.lamports).toBe(1_000_004);
    swig = fetchSwig(svm, swigAddress);
    expect(swig.authorizationLocks()).toEqual({ nextLockId: 1, locks: [] });
  });

  test('session key adds and removes a lock with its default payer', async () => {
    const svm = getSvm();
    const [root, sessionKeypair] = getFundedKeys(svm, 2);
    const swigId = randomBytes(32);
    const [swigAddress] = await findSwigPdaRaw(swigId);
    const create = await getCreateSwigInstructionContext({
      authorityInfo: createEd25519SessionAuthorityInfo(root.publicKey, 100n),
      id: swigId,
      payer: root.publicKey,
      actions: Actions.set()
        .all()
        .manageAuthorizationLocks({ maxDurationSlots: 100n })
        .get(),
    });
    sendSwigSVMTransaction(svm, create, root);

    let swig = fetchSwig(svm, swigAddress);
    const createSession = await getCreateSessionInstructionContext(
      swig,
      swig.roles[0].id,
      sessionKeypair.publicKey,
      50n,
    );
    sendSwigSVMTransaction(svm, createSession, root);

    swig = fetchSwig(svm, swigAddress);
    const role = swig.findRoleBySessionKey(sessionKeypair.publicKey);
    expect(role).toBeDefined();
    const walletAddress = toPublicKey(await getSwigWalletAddressRaw(swig));
    svm.airdrop(walletAddress, 2_000_000_000n);
    const add = await getAddSolAuthorizationLockInstructionContext(
      swig,
      role!.id,
      {
        amount: 1_000_000_000n,
        expirySlot: BigInt(svm.getClock().slot) + 20n,
      },
    );
    sendSwigSVMTransaction(svm, add, sessionKeypair);

    swig = fetchSwig(svm, swigAddress);
    const locks = swig.authorizationLocks().locks;
    expect(locks).toMatchObject([{ roleId: role!.id, amount: 1_000_000_000n }]);
    const remove = await getRemoveAuthorizationLockInstructionContext(
      swig,
      role!.id,
      { lockId: locks[0].lockId },
    );
    sendSwigSVMTransaction(svm, remove, sessionKeypair);
    expect(fetchSwig(svm, swigAddress).authorizationLocks().locks).toEqual([]);
  });

  for (const [name, createAuthority] of [
    ['secp256k1', createTestSecp256k1Authority],
    ['secp256r1', createTestSecp256r1Authority],
  ] as const) {
    test(`${name} adds and removes a SOL lock with a real signature`, async () => {
      const svm = getSvm();
      const [payer] = getFundedKeys(svm, 1);
      const recipient = generateTestKeypair();
      svm.airdrop(recipient.publicKey, 1_000_000n);
      const transfer = SolInstruction.from(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 1,
        }),
      );
      const authority = createAuthority();
      const swigId = randomBytes(32);
      const [swigAddress] = await findSwigPdaRaw(swigId);
      const create = await getCreateSwigInstructionContext({
        authorityInfo: authority.authorityInfo,
        id: swigId,
        payer: payer.publicKey,
        actions: Actions.set()
          .all()
          .manageAuthorizationLocks({ maxDurationSlots: 100n })
          .get(),
      });
      sendSwigSVMTransaction(svm, create, payer);

      let swig = fetchSwig(svm, swigAddress);
      const walletAddress = toPublicKey(await getSwigWalletAddressRaw(swig));
      svm.airdrop(walletAddress, 2_000_000_000n);
      const roleId = swig.roles[0].id;
      const options = {
        payer: payer.publicKey,
        currentSlot: svm.getClock().slot,
        signingFn: authority.signingFn ?? undefined,
        preInstructions: [transfer],
        postInstructions: [transfer],
      };
      const add = await getAddSolAuthorizationLockInstructionContext(
        swig,
        roleId,
        {
          amount: 1_000_000_000n,
          expirySlot: BigInt(options.currentSlot) + 100n,
        },
        options,
      );
      sendSwigSVMTransaction(svm, add, payer);

      swig = fetchSwig(svm, swigAddress);
      const locks = swig.authorizationLocks().locks;
      expect(locks).toMatchObject([{ roleId, amount: 1_000_000_000n }]);
      const remove = await getRemoveAuthorizationLockInstructionContext(
        swig,
        roleId,
        { lockId: locks[0].lockId },
        options,
      );
      sendSwigSVMTransaction(svm, remove, payer);
      expect(svm.getAccount(recipient.publicKey)?.lamports).toBe(1_000_004);
      expect(fetchSwig(svm, swigAddress).authorizationLocks().locks).toEqual(
        [],
      );
    });
  }

  for (const [name, tokenProgram] of [
    ['SPL Token', TOKEN_PROGRAM_ID],
    ['Token-2022', TOKEN_2022_PROGRAM_ID],
  ] as const) {
    test(`${name} lock uses the wallet ATA and rejects reservations above its balance`, async () => {
      const svm = getSvm();
      const [root] = getFundedKeys(svm, 1);
      const swigId = randomBytes(32);
      const [swigAddress] = await findSwigPdaRaw(swigId);
      const create = await getCreateSwigInstructionContext({
        authorityInfo: createEd25519AuthorityInfo(root.publicKey),
        id: swigId,
        payer: root.publicKey,
        actions: Actions.set()
          .all()
          .manageAuthorizationLocks({ maxDurationSlots: 100n })
          .get(),
      });
      sendSwigSVMTransaction(svm, create, root);

      let swig = fetchSwig(svm, swigAddress);
      const walletAddress = toPublicKey(await getSwigWalletAddressRaw(swig));
      const mintKeypair = generateTestKeypair();
      const mintAddress = mintKeypair.publicKey;
      sendSVMTransaction(
        svm,
        [
          SystemProgram.createAccount({
            fromPubkey: root.publicKey,
            newAccountPubkey: mintAddress,
            lamports: Number(
              svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)),
            ),
            space: MINT_SIZE,
            programId: tokenProgram,
          }),
          createInitializeMintInstruction(
            mintAddress,
            0,
            root.publicKey,
            null,
            tokenProgram,
          ),
        ],
        root,
        [mintKeypair],
      );
      const tokenAccount = getAssociatedTokenAddressSync(
        mintAddress,
        walletAddress,
        true,
        tokenProgram,
      );
      sendSVMTransaction(
        svm,
        [
          createAssociatedTokenAccountInstruction(
            root.publicKey,
            tokenAccount,
            walletAddress,
            mintAddress,
            tokenProgram,
          ),
          createMintToInstruction(
            mintAddress,
            tokenAccount,
            root.publicKey,
            1_000n,
            [],
            tokenProgram,
          ),
        ],
        root,
      );

      const roleId = swig.roles[0].id;
      const expirySlot = BigInt(svm.getClock().slot) + 100n;
      const add = await getAddTokenAuthorizationLockInstructionContext(
        swig,
        roleId,
        {
          mint: mintAddress,
          tokenProgram,
          amount: 600n,
          expirySlot,
        },
      );
      sendSwigSVMTransaction(svm, add, root);

      swig = fetchSwig(svm, swigAddress);
      const locks = swig.authorizationLocks().locks;
      expect(locks).toMatchObject([
        {
          assetAccount: tokenAccount.toBytes(),
          mint: mintAddress.toBytes(),
          amount: 600n,
        },
      ]);
      const accountBeforeFailure = svm.getAccount(
        toPublicKey(swigAddress),
      )!.data;
      const tooMuch = await getAddTokenAuthorizationLockInstructionContext(
        swig,
        roleId,
        { mint: mintAddress, tokenProgram, amount: 401n, expirySlot },
      );
      expect(() => sendSwigSVMTransaction(svm, tooMuch, root)).toThrow(
        'InstructionErrorCustom { code: 84 }',
      );
      expect(svm.getAccount(toPublicKey(swigAddress))!.data).toEqual(
        accountBeforeFailure,
      );

      const remove = await getRemoveAuthorizationLockInstructionContext(
        swig,
        roleId,
        { lockId: locks[0].lockId },
      );
      sendSwigSVMTransaction(svm, remove, root);
      expect(fetchSwig(svm, swigAddress).authorizationLocks().locks).toEqual(
        [],
      );
    });
  }

  test('ProgramExec adds and removes a lock with its verified preinstruction', async () => {
    const svm = getSvmWithTestProgram();
    const [payer] = getFundedKeys(svm, 1);
    const authority = createTestProgramExecAuthority();
    const swigId = randomBytes(32);
    const [swigAddress] = await findSwigPdaRaw(swigId);
    const create = await getCreateSwigInstructionContext({
      authorityInfo: authority.authorityInfo,
      id: swigId,
      payer: payer.publicKey,
      actions: Actions.set()
        .all()
        .manageAuthorizationLocks({ maxDurationSlots: 100n })
        .get(),
    });
    sendSwigSVMTransaction(svm, create, payer);

    let swig = fetchSwig(svm, swigAddress);
    const walletAddress = toPublicKey(await getSwigWalletAddressRaw(swig));
    svm.airdrop(walletAddress, 2_000_000_000n);
    const roleId = swig.roles[0].id;
    const add = await getAddSolAuthorizationLockInstructionContext(
      swig,
      roleId,
      {
        amount: 1_000_000_000n,
        expirySlot: BigInt(svm.getClock().slot) + 100n,
      },
      {
        payer: payer.publicKey,
        preInstructions: [
          createTestProgramPreInstruction(swigAddress, payer.publicKey),
        ],
      },
    );
    sendSwigSVMTransaction(svm, add, payer);

    swig = fetchSwig(svm, swigAddress);
    const locks = swig.authorizationLocks().locks;
    expect(locks).toMatchObject([{ roleId, amount: 1_000_000_000n }]);
    const remove = await getRemoveAuthorizationLockInstructionContext(
      swig,
      roleId,
      { lockId: locks[0].lockId },
      {
        payer: payer.publicKey,
        preInstructions: [
          createTestProgramPreInstruction(swigAddress, payer.publicKey),
        ],
      },
    );
    sendSwigSVMTransaction(svm, remove, payer);
    expect(fetchSwig(svm, swigAddress).authorizationLocks().locks).toEqual([]);
  });

  test('discriminators are 25 and 26', () => {
    expect(SwigInstructionDiscriminator.AddAuthorizationLockV1).toBe(25);
    expect(SwigInstructionDiscriminator.RemoveAuthorizationLockV1).toBe(26);
    expect(SwigInstructionDiscriminator.CloseSwigV1).toBe(15);
    expect(identifySwigInstruction(Uint8Array.from([25, 0]))).toBe(
      SwigInstructionDiscriminator.AddAuthorizationLockV1,
    );
    expect(identifySwigInstruction(Uint8Array.from([26, 0]))).toBe(
      SwigInstructionDiscriminator.RemoveAuthorizationLockV1,
    );
  });

  describe('AddAuthorizationLockV1', () => {
    test('Ed25519 native SOL lock matches Rust builder', async () => {
      const ctx = await Ed25519Instruction.addAuthorizationLockV1Instruction(
        {
          swig,
          payer,
          swigSystemAddress: wallet,
          assetAccount: wallet,
        },
        {
          authorityData: authority.toBytes(),
          actingRoleId: 2,
          amount: 1_000_000_000n,
          expirySlot: 123_456n,
        },
      );
      const ix = ctx.swigInstruction;

      expect(hex(ix.data)).toBe(
        '1900000002000000' +
          '04'.repeat(32) +
          '00'.repeat(32) +
          '00ca9a3b00000000' +
          '40e2010000000000' +
          '05',
      );
      expect(ix.data.length).toBe(88 + 1);
      expect(metas(ix)).toEqual([
        [swig.toBase58(), true, false],
        [payer.toBase58(), true, true],
        [SYSTEM_PROGRAM, false, false],
        [wallet.toBase58(), false, false],
        [wallet.toBase58(), false, false],
        [authority.toBase58(), false, true],
      ]);
    });

    test('Ed25519 token lock appends the mint account', async () => {
      const ctx = await Ed25519Instruction.addAuthorizationLockV1Instruction(
        {
          swig,
          payer,
          swigSystemAddress: wallet,
          assetAccount: tokenAccount,
          mint,
        },
        {
          authorityData: authority.toBytes(),
          actingRoleId: 0x01020304,
          amount: 0x0102030405060708n,
          expirySlot: 0x1112131415161718n,
        },
      );
      const ix = ctx.swigInstruction;

      expect(hex(ix.data)).toBe(
        '1900000004030201' +
          '05'.repeat(32) +
          '06'.repeat(32) +
          '0807060504030201' +
          '1817161514131211' +
          '06',
      );
      expect(metas(ix)).toEqual([
        [swig.toBase58(), true, false],
        [payer.toBase58(), true, true],
        [SYSTEM_PROGRAM, false, false],
        [wallet.toBase58(), false, false],
        [tokenAccount.toBase58(), false, false],
        [mint.toBase58(), false, false],
        [authority.toBase58(), false, true],
      ]);
    });

    test('an all-zero mint is treated as native SOL', async () => {
      const ctx = await Ed25519Instruction.addAuthorizationLockV1Instruction(
        {
          swig,
          payer,
          swigSystemAddress: wallet,
          assetAccount: wallet,
          mint: pk(0),
        },
        {
          authorityData: authority.toBytes(),
          actingRoleId: 2,
          amount: 1n,
          expirySlot: 2n,
        },
      );
      expect(ctx.swigInstruction.accounts.length).toBe(6);
    });

    test('Secp256k1 token lock matches Rust builder', async () => {
      const ctx = await Secp256k1Instruction.addAuthorizationLockV1Instruction(
        {
          swig,
          payer,
          swigSystemAddress: wallet,
          assetAccount: tokenAccount,
          mint,
        },
        {
          authorityData: new Uint8Array(64),
          actingRoleId: 1,
          amount: 42n,
          expirySlot: 900n,
        },
        { signingFn: constantSigningFn, currentSlot: 500n, odometer: 1 },
      );
      const ix = ctx.swigInstruction;

      expect(hex(ix.data)).toBe(
        '1900000001000000' +
          '05'.repeat(32) +
          '06'.repeat(32) +
          '2a00000000000000' +
          '8403000000000000' +
          'f401000000000000' +
          '01000000' +
          '11'.repeat(65),
      );
      expect(metas(ix)).toEqual([
        [swig.toBase58(), true, false],
        [payer.toBase58(), true, true],
        [SYSTEM_PROGRAM, false, false],
        [wallet.toBase58(), false, false],
        [tokenAccount.toBase58(), false, false],
        [mint.toBase58(), false, false],
      ]);
    });

    test('codec round trips', () => {
      const { codec } = getAddAuthorizationLockV1InstructionDataCodec();
      const bytes = codec.encode({
        actingRoleId: 7,
        assetAccount: tokenAccount.toBytes(),
        mint: mint.toBytes(),
        amount: 99n,
        expirySlot: 1000n,
        authorityPayload: Uint8Array.from([9]),
      });
      expect(bytes.length).toBe(89);
      const decoded = codec.decode(bytes);
      expect(decoded.discriminator).toBe(25);
      expect(decoded.actingRoleId).toBe(7);
      expect(Array.from(decoded.assetAccount)).toEqual(
        Array.from(tokenAccount.toBytes()),
      );
      expect(Array.from(decoded.mint)).toEqual(Array.from(mint.toBytes()));
      expect(decoded.amount).toBe(99n);
      expect(decoded.expirySlot).toBe(1000n);
      expect(Array.from(decoded.authorityPayload)).toEqual([9]);
    });
  });

  describe('RemoveAuthorizationLockV1', () => {
    test('Ed25519 without rent claimer matches Rust builder', async () => {
      const ctx = await Ed25519Instruction.removeAuthorizationLockV1Instruction(
        { swig, payer },
        { authorityData: authority.toBytes(), actingRoleId: 2, lockId: 9 },
      );
      const ix = ctx.swigInstruction;

      expect(hex(ix.data)).toBe('1a00000002000000090000000000000003');
      expect(metas(ix)).toEqual([
        [swig.toBase58(), true, false],
        [payer.toBase58(), true, true],
        [SYSTEM_PROGRAM, false, false],
        [authority.toBase58(), false, true],
      ]);
    });

    test('Ed25519 with rent claimer matches Rust builder', async () => {
      const ctx = await Ed25519Instruction.removeAuthorizationLockV1Instruction(
        { swig, payer, rentClaimer },
        {
          authorityData: authority.toBytes(),
          actingRoleId: 2,
          lockId: 0xdeadbeef,
        },
      );
      const ix = ctx.swigInstruction;

      expect(hex(ix.data)).toBe('1a00000002000000efbeadde0000000004');
      expect(metas(ix)).toEqual([
        [swig.toBase58(), true, false],
        [payer.toBase58(), true, true],
        [SYSTEM_PROGRAM, false, false],
        [rentClaimer.toBase58(), true, false],
        [authority.toBase58(), false, true],
      ]);
    });

    test('Secp256k1 with rent claimer matches Rust builder', async () => {
      const ctx =
        await Secp256k1Instruction.removeAuthorizationLockV1Instruction(
          { swig, payer, rentClaimer },
          { authorityData: new Uint8Array(64), actingRoleId: 1, lockId: 3 },
          { signingFn: constantSigningFn, currentSlot: 500n, odometer: 1 },
        );
      const ix = ctx.swigInstruction;

      expect(hex(ix.data)).toBe(
        '1a000000010000000300000000000000' +
          'f401000000000000' +
          '01000000' +
          '11'.repeat(65),
      );
      expect(metas(ix)).toEqual([
        [swig.toBase58(), true, false],
        [payer.toBase58(), true, true],
        [SYSTEM_PROGRAM, false, false],
        [rentClaimer.toBase58(), true, false],
      ]);
    });

    test('codec round trips', () => {
      const { codec } = getRemoveAuthorizationLockV1InstructionDataCodec();
      const bytes = codec.encode({
        actingRoleId: 4,
        lockId: 12,
        authorityPayload: Uint8Array.from([3]),
      });
      expect(bytes.length).toBe(17);
      const decoded = codec.decode(bytes);
      expect(decoded.discriminator).toBe(26);
      expect(decoded.actingRoleId).toBe(4);
      expect(decoded.lockId).toBe(12);
      expect(Array.from(decoded._reserved)).toEqual([0, 0, 0, 0]);
      expect(Array.from(decoded.authorityPayload)).toEqual([3]);
    });
  });
});
