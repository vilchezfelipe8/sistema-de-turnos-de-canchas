-- Prevent the same student from holding multiple active enrollments in one class.
-- WAITLISTED remains unique per student/session as well; CANCELLED rows are excluded.
CREATE UNIQUE INDEX "ClassEnrollment_active_student_per_session_key"
ON "ClassEnrollment"("classSessionId", "studentClientId")
WHERE "enrollmentStatus" <> 'CANCELLED';
