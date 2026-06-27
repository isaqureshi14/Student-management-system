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
