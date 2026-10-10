# M6 Voice Care v2 implementation plan

1. **Contracts** — add versioned multi-component schemas, canonical signing bytes,
   digest and generated JSON Schema while preserving v1. Verify contracts,
   schema generation and digest fixtures.
2. **Gateway** — authenticate v2 with existing device/Lease authority, route
   receipts by request digest, and implement start/update/end/confirm/cancel with
   version, warning, audit and transaction guards. Verify API typecheck and
   synthetic gateway behavior.
3. **Cross-product handoff** — keep the Baby Monitor M6 coordinator's context
   expiry separate from the Baby Care task lifetime. Verify resume/query/cancel,
   duplicate requests, retry after gateway failure and output failure isolation.
4. **Synthetic acceptance** — prove expressed breast milk 60 ml plus formula 30
   ml commits only after confirmation, while direct breastfeeding records time
   without millilitres. No real database or household media is used.
5. **Review and delivery** — run changed-package gates, privacy/diff checks,
   update handoff evidence, commit and push only the approved feature branches.

Open gates: PostgreSQL/API integration with generated v2 signed envelopes,
Node 24 CI, and any family-device acceptance remain pending.
