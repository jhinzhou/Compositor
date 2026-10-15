/* Read-only dispatch diagnostic: deliberately throws before File/app access.
 * Expected native error: alpha26 entry dispatch reached.
 * Root operator only; creates no documents and changes no preferences. */
throw new Error('alpha26 entry dispatch reached');
