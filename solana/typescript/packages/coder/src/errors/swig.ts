/** OwnerMismatch: Account {0} Owner mismatch */
const SWIG_ERROR__OWNER_MISMATCH = 0x0; // 0
/** AccountNotEmpty: Account {0} is not empty */
const SWIG_ERROR__ACCOUNT_NOT_EMPTY = 0x1; // 1
/** NotOnCurve: Account {0} must be on curve */
const SWIG_ERROR__NOT_ON_CURVE = 0x2; // 2
/** ExpectedSigner: Account {0} must be a signer */
const SWIG_ERROR__EXPECTED_SIGNER = 0x3; // 3
/** StateError: State Error: {0} */
const SWIG_ERROR__STATE_ERROR = 0x4; // 4
/** AccountBorrowFailed: Account {0} borrow failed */
const SWIG_ERROR__ACCOUNT_BORROW_FAILED = 0x5; // 5
/** InvalidAuthorityType: Invalid Authority Type */
const SWIG_ERROR__INVALID_AUTHORITY_TYPE = 0x6; // 6
/** Cpi: Call from CPI not allowed */
const SWIG_ERROR__CPI = 0x7; // 7
/** InvalidSeed: Account {0} Invalid Seeds */
const SWIG_ERROR__INVALID_SEED = 0x8; // 8
/** MissingInstructions: Missing Instructions */
const SWIG_ERROR__MISSING_INSTRUCTIONS = 0x9; // 9
/** InvalidAuthorityPayload: Invalid Authority Payload */
const SWIG_ERROR__INVALID_AUTHORITY_PAYLOAD = 0xa; // 10
/** InvalidAuthority: Invalid Authority */
const SWIG_ERROR__INVALID_AUTHORITY = 0xb; // 11
/** InstructionError: Instruction Error: {0} */
const SWIG_ERROR__INSTRUCTION_ERROR = 0xc; // 12
/** SerializationError: Serialization Error */
const SWIG_ERROR__SERIALIZATION_ERROR = 0xd; // 13
/** InvalidAccounts: Invalid Accounts {0} */
const SWIG_ERROR__INVALID_ACCOUNTS = 0xe; // 14
/** PermissionDenied: Permission Denied {0} */
const SWIG_ERROR__PERMISSION_DENIED = 0xf; // 15
/** InvalidSystemProgram: Invalid System Program */
const SWIG_ERROR__INVALID_SYSTEM_PROGRAM = 0x10; // 16
/** DuplicateAuthority: Invalid Authority */
const SWIG_ERROR__DUPLICATE_AUTHORITY = 0x11; // 17
/** InvalidOperation: Invalid Operation {0} */
const SWIG_ERROR__INVALID_OPERATION = 0x12; // 18

export type SwigError =
  | typeof SWIG_ERROR__ACCOUNT_BORROW_FAILED
  | typeof SWIG_ERROR__ACCOUNT_NOT_EMPTY
  | typeof SWIG_ERROR__CPI
  | typeof SWIG_ERROR__DUPLICATE_AUTHORITY
  | typeof SWIG_ERROR__EXPECTED_SIGNER
  | typeof SWIG_ERROR__INSTRUCTION_ERROR
  | typeof SWIG_ERROR__INVALID_ACCOUNTS
  | typeof SWIG_ERROR__INVALID_AUTHORITY
  | typeof SWIG_ERROR__INVALID_AUTHORITY_PAYLOAD
  | typeof SWIG_ERROR__INVALID_AUTHORITY_TYPE
  | typeof SWIG_ERROR__INVALID_OPERATION
  | typeof SWIG_ERROR__INVALID_SEED
  | typeof SWIG_ERROR__INVALID_SYSTEM_PROGRAM
  | typeof SWIG_ERROR__MISSING_INSTRUCTIONS
  | typeof SWIG_ERROR__NOT_ON_CURVE
  | typeof SWIG_ERROR__OWNER_MISMATCH
  | typeof SWIG_ERROR__PERMISSION_DENIED
  | typeof SWIG_ERROR__SERIALIZATION_ERROR
  | typeof SWIG_ERROR__STATE_ERROR;

let swigErrorMessages: Record<SwigError, string> | undefined;
if (process.env.NODE_ENV !== 'production') {
  swigErrorMessages = {
    [SWIG_ERROR__ACCOUNT_BORROW_FAILED]: `Account {0} borrow failed`,
    [SWIG_ERROR__ACCOUNT_NOT_EMPTY]: `Account {0} is not empty`,
    [SWIG_ERROR__CPI]: `Call from CPI not allowed`,
    [SWIG_ERROR__DUPLICATE_AUTHORITY]: `Invalid Authority`,
    [SWIG_ERROR__EXPECTED_SIGNER]: `Account {0} must be a signer`,
    [SWIG_ERROR__INSTRUCTION_ERROR]: `Instruction Error: {0}`,
    [SWIG_ERROR__INVALID_ACCOUNTS]: `Invalid Accounts {0}`,
    [SWIG_ERROR__INVALID_AUTHORITY]: `Invalid Authority`,
    [SWIG_ERROR__INVALID_AUTHORITY_PAYLOAD]: `Invalid Authority Payload`,
    [SWIG_ERROR__INVALID_AUTHORITY_TYPE]: `Invalid Authority Type`,
    [SWIG_ERROR__INVALID_OPERATION]: `Invalid Operation {0}`,
    [SWIG_ERROR__INVALID_SEED]: `Account {0} Invalid Seeds`,
    [SWIG_ERROR__INVALID_SYSTEM_PROGRAM]: `Invalid System Program`,
    [SWIG_ERROR__MISSING_INSTRUCTIONS]: `Missing Instructions`,
    [SWIG_ERROR__NOT_ON_CURVE]: `Account {0} must be on curve`,
    [SWIG_ERROR__OWNER_MISMATCH]: `Account {0} Owner mismatch`,
    [SWIG_ERROR__PERMISSION_DENIED]: `Permission Denied {0}`,
    [SWIG_ERROR__SERIALIZATION_ERROR]: `Serialization Error`,
    [SWIG_ERROR__STATE_ERROR]: `State Error: {0}`,
  };
}

export function getSwigErrorMessage(code: SwigError): string {
  if (process.env.NODE_ENV !== 'production') {
    return (swigErrorMessages as Record<SwigError, string>)[code];
  }

  return 'Error message not available in production bundles.';
}
