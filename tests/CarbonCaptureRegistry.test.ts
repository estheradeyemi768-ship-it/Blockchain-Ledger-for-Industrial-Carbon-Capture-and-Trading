
import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Facility {
  owner: string;
  name: string;
  location: string;
  description: string;
  registeredAt: number;
  active: boolean;
}

interface CaptureEvent {
  facilityId: number;
  hash: Uint8Array; // Represent buff 32
  amount: number;
  timestamp: number;
  metadata: string;
  verified: boolean;
  verifier?: string;
}

interface ContractState {
  admin: string;
  paused: boolean;
  totalCaptured: number;
  facilityCounter: number;
  eventCounter: number;
  facilities: Map<number, Facility>;
  captureEvents: Map<number, CaptureEvent>;
  facilityEvents: Map<number, { events: number[] }>;
  authorizedOracles: Map<string, boolean>;
}

// Mock contract implementation
class CarbonCaptureRegistryMock {
  private state: ContractState = {
    admin: "deployer",
    paused: false,
    totalCaptured: 0,
    facilityCounter: 0,
    eventCounter: 0,
    facilities: new Map(),
    captureEvents: new Map(),
    facilityEvents: new Map(),
    authorizedOracles: new Map(),
  };

  private ERR_FACILITY_EXISTS = 100;
  private ERR_FACILITY_NOT_FOUND = 101;
  private ERR_UNAUTHORIZED = 102;
  private ERR_INVALID_HASH = 103;
  private ERR_INVALID_AMOUNT = 104;
  private ERR_INVALID_TIMESTAMP = 105;
  private ERR_PAUSED = 106;
  private ERR_METADATA_TOO_LONG = 107;
  private ERR_INVALID_FACILITY_ID = 108;
  private ERR_ALREADY_VERIFIED = 109;
  private ERR_EVENT_EXISTS = 110; // Added for completeness
  private MAX_METADATA_LEN = 1000;
  private MAX_DESCRIPTION_LEN = 500;

  // Simulate block height
  private currentBlockHeight = 100;

  private getBlockHeight(): number {
    return this.currentBlockHeight++;
  }

  getContractAdmin(): ClarityResponse<string> {
    return { ok: true, value: this.state.admin };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getTotalCaptured(): ClarityResponse<number> {
    return { ok: true, value: this.state.totalCaptured };
  }

  getFacilityDetails(facilityId: number): ClarityResponse<Facility | null> {
    return { ok: true, value: this.state.facilities.get(facilityId) ?? null };
  }

  getCaptureEvent(eventId: number): ClarityResponse<CaptureEvent | null> {
    return { ok: true, value: this.state.captureEvents.get(eventId) ?? null };
  }

  getFacilityEventList(facilityId: number): ClarityResponse<{ events: number[] }> {
    return { ok: true, value: this.state.facilityEvents.get(facilityId) ?? { events: [] } };
  }

  isOracleAuthorized(oracle: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.authorizedOracles.get(oracle) ?? false };
  }

  calculateFacilityTotal(facilityId: number): ClarityResponse<number> {
    const events = this.state.facilityEvents.get(facilityId)?.events ?? [];
    const total = events.reduce((sum, id) => {
      const event = this.state.captureEvents.get(id);
      return event && event.verified ? sum + event.amount : sum;
    }, 0);
    return { ok: true, value: total };
  }

  setAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  addOracle(caller: string, oracle: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.authorizedOracles.set(oracle, true);
    return { ok: true, value: true };
  }

  removeOracle(caller: string, oracle: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.authorizedOracles.delete(oracle);
    return { ok: true, value: true };
  }

  registerFacility(
    caller: string,
    name: string,
    location: string,
    description: string
  ): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (description.length > this.MAX_DESCRIPTION_LEN) {
      return { ok: false, value: this.ERR_METADATA_TOO_LONG };
    }
    const facilityId = this.state.facilityCounter + 1;
    this.state.facilities.set(facilityId, {
      owner: caller,
      name,
      location,
      description,
      registeredAt: this.getBlockHeight(),
      active: true,
    });
    this.state.facilityEvents.set(facilityId, { events: [] });
    this.state.facilityCounter = facilityId;
    return { ok: true, value: facilityId };
  }

  updateFacilityStatus(caller: string, facilityId: number, active: boolean): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const facility = this.state.facilities.get(facilityId);
    if (!facility) {
      return { ok: false, value: this.ERR_FACILITY_NOT_FOUND };
    }
    if (facility.owner !== caller) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    facility.active = active;
    this.state.facilities.set(facilityId, facility);
    return { ok: true, value: true };
  }

  registerCapture(
    caller: string,
    facilityId: number,
    hash: Uint8Array,
    amount: number,
    timestamp: number,
    metadata: string
  ): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const facility = this.state.facilities.get(facilityId);
    if (!facility || !facility.active) {
      return { ok: false, value: this.ERR_FACILITY_NOT_FOUND };
    }
    if (facility.owner !== caller && !this.state.authorizedOracles.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (hash.length !== 32) {
      return { ok: false, value: this.ERR_INVALID_HASH };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (timestamp <= 0) {
      return { ok: false, value: this.ERR_INVALID_TIMESTAMP };
    }
    if (metadata.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_METADATA_TOO_LONG };
    }
    const eventId = this.state.eventCounter + 1;
    this.state.captureEvents.set(eventId, {
      facilityId,
      hash,
      amount,
      timestamp,
      metadata,
      verified: false,
    });
    const facilityEvents = this.state.facilityEvents.get(facilityId)!;
    facilityEvents.events.push(eventId);
    this.state.facilityEvents.set(facilityId, facilityEvents);
    this.state.eventCounter = eventId;
    return { ok: true, value: eventId };
  }

  verifyCapture(caller: string, eventId: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const event = this.state.captureEvents.get(eventId);
    if (!event) {
      return { ok: false, value: this.ERR_FACILITY_NOT_FOUND };
    }
    if (event.verified) {
      return { ok: false, value: this.ERR_ALREADY_VERIFIED };
    }
    if (!this.state.authorizedOracles.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    event.verified = true;
    event.verifier = caller;
    this.state.captureEvents.set(eventId, event);
    this.state.totalCaptured += event.amount;
    return { ok: true, value: true };
  }

  updateEventMetadata(caller: string, eventId: number, newMetadata: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const event = this.state.captureEvents.get(eventId);
    if (!event) {
      return { ok: false, value: this.ERR_FACILITY_NOT_FOUND };
    }
    const facility = this.state.facilities.get(event.facilityId);
    if (!facility || facility.owner !== caller) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (event.verified) {
      return { ok: false, value: this.ERR_ALREADY_VERIFIED };
    }
    if (newMetadata.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_METADATA_TOO_LONG };
    }
    event.metadata = newMetadata;
    this.state.captureEvents.set(eventId, event);
    return { ok: true, value: true };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  owner: "wallet_1",
  oracle: "wallet_2",
  unauthorized: "wallet_3",
};

describe("CarbonCaptureRegistry Contract", () => {
  let contract: CarbonCaptureRegistryMock;

  beforeEach(() => {
    contract = new CarbonCaptureRegistryMock();
    vi.resetAllMocks();
  });

  it("should initialize with correct defaults", () => {
    expect(contract.getContractAdmin()).toEqual({ ok: true, value: "deployer" });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
    expect(contract.getTotalCaptured()).toEqual({ ok: true, value: 0 });
  });

  it("should allow admin to add oracle", () => {
    const addOracle = contract.addOracle(accounts.deployer, accounts.oracle);
    expect(addOracle).toEqual({ ok: true, value: true });
    expect(contract.isOracleAuthorized(accounts.oracle)).toEqual({ ok: true, value: true });
  });

  it("should prevent non-admin from adding oracle", () => {
    const addOracle = contract.addOracle(accounts.unauthorized, accounts.oracle);
    expect(addOracle).toEqual({ ok: false, value: 102 });
  });

  it("should register a facility", () => {
    const register = contract.registerFacility(
      accounts.owner,
      "Test Facility",
      "Location X",
      "Description"
    );
    expect(register).toEqual({ ok: true, value: 1 });
    const details = contract.getFacilityDetails(1);
    expect(details).toEqual({
      ok: true,
      value: expect.objectContaining({
        owner: accounts.owner,
        name: "Test Facility",
        active: true,
      }),
    });
  });

  it("should prevent registration when paused", () => {
    contract.pauseContract(accounts.deployer);
    const register = contract.registerFacility(
      accounts.owner,
      "Test",
      "Loc",
      "Desc"
    );
    expect(register).toEqual({ ok: false, value: 106 });
  });

  it("should register and verify capture event", () => {
    contract.registerFacility(accounts.owner, "Test", "Loc", "Desc");
    contract.addOracle(accounts.deployer, accounts.oracle);

    const hash = new Uint8Array(32).fill(0); // Mock hash
    const registerCapture = contract.registerCapture(
      accounts.owner,
      1,
      hash,
      1000,
      1234567890,
      "Metadata"
    );
    expect(registerCapture).toEqual({ ok: true, value: 1 });

    const verify = contract.verifyCapture(accounts.oracle, 1);
    expect(verify).toEqual({ ok: true, value: true });

    const event = contract.getCaptureEvent(1);
    expect(event).toEqual({
      ok: true,
      value: expect.objectContaining({
        amount: 1000,
        verified: true,
        verifier: accounts.oracle,
      }),
    });
    expect(contract.getTotalCaptured()).toEqual({ ok: true, value: 1000 });
  });

  it("should prevent unauthorized verification", () => {
    contract.registerFacility(accounts.owner, "Test", "Loc", "Desc");
    const hash = new Uint8Array(32).fill(0);
    contract.registerCapture(accounts.owner, 1, hash, 1000, 1234567890, "Meta");

    const verify = contract.verifyCapture(accounts.unauthorized, 1);
    expect(verify).toEqual({ ok: false, value: 102 });
  });

  it("should update event metadata before verification", () => {
    contract.registerFacility(accounts.owner, "Test", "Loc", "Desc");
    const hash = new Uint8Array(32).fill(0);
    contract.registerCapture(accounts.owner, 1, hash, 1000, 1234567890, "Old Meta");

    const update = contract.updateEventMetadata(accounts.owner, 1, "New Meta");
    expect(update).toEqual({ ok: true, value: true });

    const event = contract.getCaptureEvent(1);
    expect(event).toEqual({
      ok: true,
      value: expect.objectContaining({ metadata: "New Meta" }),
    });
  });

  it("should prevent metadata update after verification", () => {
    contract.registerFacility(accounts.owner, "Test", "Loc", "Desc");
    contract.addOracle(accounts.deployer, accounts.oracle);
    const hash = new Uint8Array(32).fill(0);
    contract.registerCapture(accounts.owner, 1, hash, 1000, 1234567890, "Meta");
    contract.verifyCapture(accounts.oracle, 1);

    const update = contract.updateEventMetadata(accounts.owner, 1, "New");
    expect(update).toEqual({ ok: false, value: 109 });
  });

  it("should calculate facility total correctly", () => {
    contract.registerFacility(accounts.owner, "Test", "Loc", "Desc");
    contract.addOracle(accounts.deployer, accounts.oracle);
    const hash1 = new Uint8Array(32).fill(1);
    const hash2 = new Uint8Array(32).fill(2);
    contract.registerCapture(accounts.owner, 1, hash1, 1000, 123, "Meta1");
    contract.registerCapture(accounts.owner, 1, hash2, 2000, 456, "Meta2");
    contract.verifyCapture(accounts.oracle, 1);
    // Don't verify second

    const total = contract.calculateFacilityTotal(1);
    expect(total).toEqual({ ok: true, value: 1000 });
  });

  it("should prevent invalid hash length", () => {
    contract.registerFacility(accounts.owner, "Test", "Loc", "Desc");
    const invalidHash = new Uint8Array(31);
    const register = contract.registerCapture(
      accounts.owner,
      1,
      invalidHash,
      1000,
      123,
      "Meta"
    );
    expect(register).toEqual({ ok: false, value: 103 });
  });

  it("should prevent zero amount", () => {
    contract.registerFacility(accounts.owner, "Test", "Loc", "Desc");
    const hash = new Uint8Array(32);
    const register = contract.registerCapture(
      accounts.owner,
      1,
      hash,
      0,
      123,
      "Meta"
    );
    expect(register).toEqual({ ok: false, value: 104 });
  });
});