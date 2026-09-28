------------------------------ MODULE Log ------------------------------
(* One run's log, appended by the recorder and read by a follower
   (SPEC.md FR-4, FR-12, FR-13, FR-14). Event k is the byte k, then a
   newline (0) written in a separate step, so a reader can see half a line.
   Event N is run.end. The process exits after it or is killed before it. *)
EXTENDS Naturals, Sequences

CONSTANT N

VARIABLES log, next, alive, pos, emitted, lost

logVars == <<log, next, alive, pos, emitted, lost>>

MidLine == Len(log) > 0 /\ log[Len(log)] # 0

LogInit == /\ log = <<>> /\ next = 1 /\ alive = TRUE
           /\ pos = 0 /\ emitted = <<>> /\ lost = FALSE

WriteEvent == /\ alive /\ ~MidLine /\ next <= N /\ log' = Append(log, next)
              /\ UNCHANGED <<next, alive, pos, emitted, lost>>

WriteNewline == /\ alive /\ MidLine /\ log' = Append(log, 0) /\ next' = next + 1
                /\ UNCHANGED <<alive, pos, emitted, lost>>

Exit == /\ alive /\ next = N + 1 /\ alive' = FALSE
        /\ UNCHANGED <<log, next, pos, emitted, lost>>

Kill == /\ alive /\ next <= N /\ alive' = FALSE
        /\ UNCHANGED <<log, next, pos, emitted, lost>>

Read == /\ pos < Len(log) /\ pos' = pos + 1
        /\ emitted' = IF log[pos + 1] = 0 THEN Append(emitted, log[pos]) ELSE emitted
        /\ UNCHANGED <<log, next, alive, lost>>

Step == WriteEvent \/ WriteNewline \/ Exit \/ Kill \/ Read

Ended == \E i \in 1..Len(emitted) : emitted[i] = N

TypeOK == /\ log \in Seq(0..N) /\ next \in 1..N + 1 /\ pos \in 0..Len(log)
          /\ emitted \in Seq(1..N)

\* FR-12: each complete line once, in the order written, never half a line.
InOrderOnce == /\ Len(emitted) <= next - 1
               /\ \A i \in 1..Len(emitted) : emitted[i] = i

\* FR-14: run.lost only for a run that is dead and never finished run.end.
LostSound == lost => (~alive /\ next <= N)

\* FR-13: every complete line is emitted.
AllEmitted == <>[](Len(emitted) = next - 1)

\* FR-14: a killed run is reported lost.
KilledIsLost == (~alive /\ next <= N) ~> lost
=======================================================================
