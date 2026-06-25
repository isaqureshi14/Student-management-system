# Implementation Plan - Automatic Timetable Synchronization

This plan details the design for automatically updating a teacher's timetable when the owner modifies schedule entries or teacher details.

## Proposed Changes

---

### 1. Database & Backend Name Propagation
- **Problem**: When a teacher's name is modified (e.g. from `"Dr. Hema Sharma"` to `"Hema Sharma"`), existing rows in the `timetable` table retain the old name. The teacher's view then fails to display those entries due to name mismatch.
- **Solution**:
  - In `backend/routes/teachers.js` `PUT /api/teachers/:id`, retrieve the old full name before the update. If the name changes after the update, run `UPDATE timetable SET teacher_name = ? WHERE teacher_name = ?` to propagate the name change to all timetable entries.
  - In `backend/routes/timetable.js`, trim resolved teacher names in both `POST /` and `POST /bulk` to prevent trailing whitespace comparison issues.

---

### 2. Frontend Real-Time Refresh (Teacher Portal)
- **Problem**: When the owner updates the timetable in the Owner Portal, a teacher currently viewing their portal does not see the changes until they refresh the browser.
- **Solution**:
  - In `4teacher_page.html`, define an asynchronous function `refreshTimetable()` that fetches the teacher's profile and the latest global timetable, filters entries for this teacher, updates `teacherDb.timetable`, and calls `renderTimetableMatrix()`.
  - In the page initialization, start a background polling interval (`setInterval`) to call `refreshTimetable()` every 10 seconds.

---

## Verification Plan

### Automated/Manual Verification
1. **Teacher Update Sync**: Edit a teacher's name in the Owner Portal. Verify that their name propagates to their assigned slots in the database.
2. **Timetable Auto-Refresh**: Log in as a teacher in one browser tab and go to the Timetable view. Log in as the owner in another tab. Add or modify a timetable entry for that teacher's subject. Verify that within 10 seconds, the teacher's schedule matrix updates automatically without refreshing the page.
