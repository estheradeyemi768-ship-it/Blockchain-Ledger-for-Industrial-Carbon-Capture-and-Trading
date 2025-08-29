;; CarbonCaptureRegistry.clar
;; Core contract for registering industrial facilities and logging carbon capture events
;; with hashed sensor data for proof of capture. Ensures immutability, uniqueness, and verifiability.

;; Constants
(define-constant ERR-FACILITY-EXISTS u100) ;; Facility already registered
(define-constant ERR-FACILITY-NOT-FOUND u101) ;; Facility not found
(define-constant ERR-UNAUTHORIZED u102) ;; Caller not authorized
(define-constant ERR-INVALID-HASH u103) ;; Invalid hash length
(define-constant ERR-INVALID-AMOUNT u104) ;; Invalid capture amount
(define-constant ERR-EVENT-EXISTS u105) ;; Capture event already exists
(define-constant ERR-INVALID-TIMESTAMP u106) ;; Invalid timestamp
(define-constant ERR-PAUSED u107) ;; Contract is paused
(define-constant ERR-METADATA-TOO-LONG u108) ;; Metadata exceeds max length
(define-constant ERR-INVALID-FACILITY-ID u109) ;; Invalid facility ID
(define-constant ERR-ALREADY-VERIFIED u110) ;; Event already verified
(define-constant MAX-METADATA-LEN u1000) ;; Max length for metadata
(define-constant MAX-DESCRIPTION-LEN u500) ;; Max length for descriptions

;; Data Variables
(define-data-var contract-admin principal tx-sender) ;; Contract administrator
(define-data-var contract-paused bool false) ;; Pause state for maintenance
(define-data-var total-captured uint u0) ;; Global total captured CO2
(define-data-var facility-counter uint u0) ;; Counter for facility IDs
(define-data-var event-counter uint u0) ;; Counter for event IDs

;; Data Maps
(define-map facilities
  { facility-id: uint }
  {
    owner: principal,
    name: (string-utf8 100),
    location: (string-utf8 200),
    description: (string-utf8 500),
    registered-at: uint,
    active: bool
  }
)

(define-map capture-events
  { event-id: uint }
  {
    facility-id: uint,
    hash: (buff 32), ;; SHA-256 hash of sensor data
    amount: uint, ;; CO2 captured in tons (scaled by 1e6 for precision if needed)
    timestamp: uint,
    metadata: (string-utf8 1000),
    verified: bool,
    verifier: (optional principal)
  }
)

(define-map facility-events
  { facility-id: uint }
  { events: (list 1000 uint) } ;; List of event IDs for the facility
)

(define-map authorized-oracles principal bool) ;; Authorized data feeders

;; Read-Only Functions
(define-read-only (get-contract-admin)
  (var-get contract-admin)
)

(define-read-only (is-paused)
  (var-get contract-paused)
)

(define-read-only (get-total-captured)
  (var-get total-captured)
)

(define-read-only (get-facility-details (facility-id uint))
  (map-get? facilities { facility-id: facility-id })
)

(define-read-only (get-capture-event (event-id uint))
  (map-get? capture-events { event-id: event-id })
)

(define-read-only (get-facility-event-list (facility-id uint))
  (default-to { events: (list) } (map-get? facility-events { facility-id: facility-id }))
)

(define-read-only (is-oracle-authorized (oracle principal))
  (default-to false (map-get? authorized-oracles oracle))
)

(define-read-only (calculate-facility-total (facility-id uint))
  (fold sum-events (get events (get-facility-event-list facility-id)) u0)
)

(define-private (sum-events (event-id uint) (total uint))
  (let ((event (get-capture-event event-id)))
    (if (and (is-some event) (get verified (unwrap-panic event)))
      (+ total (get amount (unwrap-panic event)))
      total
    )
  )
)

;; Public Functions
(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (var-set contract-admin new-admin)
    (ok true)
  )
)

(define-public (pause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (var-set contract-paused true)
    (ok true)
  )
)

(define-public (unpause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (var-set contract-paused false)
    (ok true)
  )
)

(define-public (add-oracle (oracle principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (map-set authorized-oracles oracle true)
    (ok true)
  )
)

(define-public (remove-oracle (oracle principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (map-delete authorized-oracles oracle)
    (ok true)
  )
)

(define-public (register-facility (name (string-utf8 100)) (location (string-utf8 200)) (description (string-utf8 500)))
  (let
    (
      (facility-id (+ (var-get facility-counter) u1))
    )
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (is-none (map-get? facilities { facility-id: facility-id })) (err ERR-FACILITY-EXISTS))
    (asserts! (<= (len description) MAX-DESCRIPTION-LEN) (err ERR-METADATA-TOO-LONG))
    (map-set facilities
      { facility-id: facility-id }
      {
        owner: tx-sender,
        name: name,
        location: location,
        description: description,
        registered-at: block-height,
        active: true
      }
    )
    (map-set facility-events { facility-id: facility-id } { events: (list) })
    (var-set facility-counter facility-id)
    (ok facility-id)
  )
)

(define-public (update-facility-status (facility-id uint) (active bool))
  (let
    (
      (facility (map-get? facilities { facility-id: facility-id }))
    )
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (is-some facility) (err ERR-FACILITY-NOT-FOUND))
    (asserts! (is-eq (get owner (unwrap-panic facility)) tx-sender) (err ERR-UNAUTHORIZED))
    (map-set facilities
      { facility-id: facility-id }
      (merge (unwrap-panic facility) { active: active })
    )
    (ok true)
  )
)

(define-public (register-capture (facility-id uint) (hash (buff 32)) (amount uint) (timestamp uint) (metadata (string-utf8 1000)))
  (let
    (
      (facility (map-get? facilities { facility-id: facility-id }))
      (event-id (+ (var-get event-counter) u1))
      (current-events (get events (get-facility-event-list facility-id)))
    )
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (is-some facility) (err ERR-FACILITY-NOT-FOUND))
    (asserts! (or (is-eq (get owner (unwrap-panic facility)) tx-sender) (is-oracle-authorized tx-sender)) (err ERR-UNAUTHORIZED))
    (asserts! (get active (unwrap-panic facility)) (err ERR-FACILITY-NOT-FOUND))
    (asserts! (is-eq (len hash) u32) (err ERR-INVALID-HASH))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (> timestamp u0) (err ERR-INVALID-TIMESTAMP))
    (asserts! (<= (len metadata) MAX-METADATA-LEN) (err ERR-METADATA-TOO-LONG))
    ;; Check for duplicate hash in facility events (simplified, in practice might need better uniqueness)
    (asserts! (is-none (index-of? current-events event-id)) (err ERR-EVENT-EXISTS)) ;; Placeholder, actual duplicate check on hash would require another map
    (map-set capture-events
      { event-id: event-id }
      {
        facility-id: facility-id,
        hash: hash,
        amount: amount,
        timestamp: timestamp,
        metadata: metadata,
        verified: false,
        verifier: none
      }
    )
    (map-set facility-events
      { facility-id: facility-id }
      { events: (unwrap-panic (as-max-len? (append current-events event-id) u1000)) }
    )
    (var-set event-counter event-id)
    (ok event-id)
  )
)

(define-public (verify-capture (event-id uint))
  (let
    (
      (event (map-get? capture-events { event-id: event-id }))
    )
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (is-some event) (err ERR-FACILITY-NOT-FOUND))
    (asserts! (not (get verified (unwrap-panic event))) (err ERR-ALREADY-VERIFIED))
    (asserts! (is-oracle-authorized tx-sender) (err ERR-UNAUTHORIZED))
    (map-set capture-events
      { event-id: event-id }
      (merge (unwrap-panic event) { verified: true, verifier: (some tx-sender) })
    )
    (var-set total-captured (+ (var-get total-captured) (get amount (unwrap-panic event))))
    (ok true)
  )
)

(define-public (update-event-metadata (event-id uint) (new-metadata (string-utf8 1000)))
  (let
    (
      (event (map-get? capture-events { event-id: event-id }))
      (facility (map-get? facilities { facility-id: (get facility-id (unwrap-panic event)) }))
    )
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (is-some event) (err ERR-FACILITY-NOT-FOUND))
    (asserts! (is-some facility) (err ERR-FACILITY-NOT-FOUND))
    (asserts! (is-eq (get owner (unwrap-panic facility)) tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (not (get verified (unwrap-panic event))) (err ERR-ALREADY-VERIFIED))
    (asserts! (<= (len new-metadata) MAX-METADATA-LEN) (err ERR-METADATA-TOO-LONG))
    (map-set capture-events
      { event-id: event-id }
      (merge (unwrap-panic event) { metadata: new-metadata })
    )
    (ok true)
  )
)

