---------------------------- MODULE Follow ----------------------------
(* The follower's protocol for run.lost (FR-14): see the pid dead, then read
   the log to its end, then decide. *)
EXTENDS Log

VARIABLE sawDead

vars == <<log, next, alive, pos, emitted, lost, sawDead>>

FollowRead == Read /\ UNCHANGED sawDead

SeeDead == /\ ~alive /\ ~sawDead /\ sawDead' = TRUE /\ UNCHANGED logVars

Lost == /\ sawDead /\ pos = Len(log) /\ ~Ended /\ ~lost /\ lost' = TRUE
        /\ UNCHANGED <<log, next, alive, pos, emitted, sawDead>>

Next == (Step /\ UNCHANGED sawDead) \/ SeeDead \/ Lost

Spec == LogInit /\ sawDead = FALSE /\ [][Next]_vars
        /\ WF_vars(FollowRead) /\ WF_vars(SeeDead) /\ WF_vars(Lost)
=======================================================================
