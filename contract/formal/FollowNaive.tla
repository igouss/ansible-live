------------------------- MODULE FollowNaive -------------------------
(* The order the protocol replaces: check for the end of the log, then the
   pid. It must fail LostSound (see Follow.tla). *)
EXTENDS Log

VARIABLE atEOF

vars == <<log, next, alive, pos, emitted, lost, atEOF>>

SeeEOF == /\ ~lost /\ atEOF' = (pos = Len(log)) /\ UNCHANGED logVars

Lost == /\ atEOF /\ ~alive /\ ~Ended /\ ~lost /\ lost' = TRUE
        /\ UNCHANGED <<log, next, alive, pos, emitted, atEOF>>

Next == (Step /\ UNCHANGED atEOF) \/ SeeEOF \/ Lost

Spec == LogInit /\ atEOF = FALSE /\ [][Next]_vars
=======================================================================
