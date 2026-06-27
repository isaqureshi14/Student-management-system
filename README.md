# Student Management System (Sunrise Admin Hub)

A comprehensive, responsive, and feature-rich institutional portal designed for modern school management. This system provides tailored views and workspaces for Administrators/Managers, Faculty/Teachers, Students, and Parents.

## 🚀 Key Modules & Portals

### 1. Manager Console / Owner Portal (`5owner_page.html`)
- **Institution Configurations**: Define class names, subjects, and parameters.
- **Teacher Management**: Register, view, edit, and reset faculty profiles and login credentials.
- **Timetable Scheduler**: Create class timetables with duration presets, auto-scheduling timings, and timing synchronization across days. Uses a custom-built 12-hour format picker (AM/PM) for maximum display clarity.
- **All Students Attendance Report**: Review active check-in standings across classes. Managers can toggle dynamically between the **Subject Summary (Aggregated)** view and the **Daily Log (Detailed)** check-in format.

### 2. Teacher Portal (`4teacher_page.html`)
- **Attendance Registry**: Record daily check-ins (Present, Absent, Late) for student cohorts.
- **Grade Book Upload**: Upload and manage evaluation scores (Midterms, Finals, Unit Tests) with score boundaries and weights.
- **Student Directory**: Inspect roster lists and profile sheets.

### 3. Student Portal (`2student_page.html`)
- **Academic Dashboard**: Check active classes, subject metrics, and grade progression.
- **Evaluation Sheets**: View term reports and subject evaluations.
- **Timetable Planner**: Stay up to date with subject schedules.

### 4. Parent Portal (`3parent_page.html`)
- **Dashboard Overview**: Check overall student attendance rating and academic standings.
- **Attendance Logs History**: Access detailed, day-by-day logs of checked sessions showing Subject, Date, Status, and Marked By.
- **Exam Marks History Log**: Full list of academic evaluations showing Exam Name, Subject, Score, Max Marks, Percentage, and uploading teacher.
- **Leave Request Petitions**: Justify past absences or request upcoming future leaves for institutional approval.

---

## 💾 Database Schema & Architecture

The system uses a database initialized and managed through `backend/db.js`. Below are the primary entities and relations:

### 1. Account Administration & Users (`users`)
- Stores user credentials, hashed passwords (using `bcryptjs` with 12 rounds), and access levels.
- **Roles**: `STUDENT`, `TEACHER`, `PARENT`, `OWNER`.
- **Relationship**: Connects to specific demographic logs via `linked_id`.

### 2. Student Directory (`students`)
- Stores complete demographic records, contact details, address records, and profile photos.
- **Approval System**: Implements a pending review state for parent demographic edits (`profile_status` of `PENDING` or `APPROVED`) which require owner approval.

### 3. Faculty Directory (`teachers`)
- Stores first/last name, subject specialty, email, phone, and photo.

### 4. Performance Registry (`marks`)
- Connects evaluations to students. Stores:
  - `student_id` (foreign key pointing to students)
  - `exam_name`, `subject`
  - `score`, `max_score`
  - `uploaded_by` (foreign key pointing to users)

### 5. Attendance Log (`attendance`)
- Tracks daily class attendance states (`PRESENT`, `ABSENT`, `LATE`) per subject per day.
- Implements a composite unique index on `(student_id, subject, date)` to enforce single daily entries.

### 6. Timetable Scheduler (`timetable`)
- Maps periods 1 to 8 for weekdays Monday to Saturday per class.
- Stores: `class`, `day`, `period`, `subject`, `teacher_name`, `start_time`, `end_time`.
- Composite unique index on `(class, day, period)`.

### 7. Leave Petitions (`leave_requests`)
- Tracks leave requests submitted by parents for student absences.
- Statuses: `PENDING`, `APPROVED`, `REJECTED`. Reviewable by Owners.

### 8. Lecture Material & Notes (`notes`)
- Stores file reference URLs, titles, subjects, and classes of shared resources uploaded by teachers.

---

## ⚙️ Backend Working & API Flow

1. **Authentication**: Handled via secure credentials. The client passes authentication tokens in headers for API validation.
2. **Dashboard Syncing**: Upon loading any portal page, the client reads the current user's profile and populates subject attendance indices, evaluation records, and timetables.
3. **Real-time Synchronization**: Changes made in the scheduling and grade pages are transmitted to the database via REST endpoints, refreshing the parent and student dashboards instantly.

---

## 🛠️ Technology Stack
- **Frontend**: Vanilla HTML5, JavaScript (ES6+), CSS3 styled with the Tailwind CSS framework, FontAwesome Icons.
- **Backend API**: Connected via REST integration (handles authentication, profiles, attendance data, leaves, and marks).
- **Deployment Configuration**: Ready for cloud platform hosting (contains `render.yaml` template).

---

## 📦 Getting Started & Running Locally

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/isaqureshi14/Student-management-system.git
   cd Student-management-system
   ```

2. **Run the Project**:
   Double-click `start.bat` or run it from the console to start a local development server hosting the static pages.
   
3. **Open in Browser**:
   Navigate to the local dev URL (typically `http://localhost:3000` or `http://localhost:5000` depending on your server configuration) or load `index.html` directly in your browser.

---

## 📜 License
This project is licensed under the **Non-Commercial Educational License**. You are free to use, copy, and modify this software for educational and personal learning purposes. Selling, renting, or any commercial use is strictly prohibited. For details, see the [LICENSE](file:///d:/DEPLOY/LICENSE) file.

---

## 👥 Contributors
- **Isa Qureshi**
- **Ansari Rehan**
