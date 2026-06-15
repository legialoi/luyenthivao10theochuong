# Security Specification

## Data Invariants
- Questions must have a valid category and exactly 4 options.
- Results must have a name, class, and score between 0 and 4.
- Only the admin (legialoi@gmail.com) can modify questions or delete results.

## The Dirty Dozen Payloads (to be blocked)
1. Creating a question without a category.
2. Creating a question with 5 options.
3. Updating a question's content to a 2MB string.
4. Setting a negative score in a result.
5. Setting a score > 4 in a result.
6. A student deleting their own (or others') results.
7. A student modifying the question bank.
8. Submitting a result without a name.
9. Injecting script tags into question content.
10. Spoofing the timestamp of a submission.
11. Setting an invalid ID (extremely long).
12. Attempting to update a submitted result (terminal state).

## Test Runner
See `firestore.rules.test.ts` (conceptual).
