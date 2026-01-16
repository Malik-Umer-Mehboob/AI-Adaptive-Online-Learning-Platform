$(document).ready(function() {
    const API_BASE = 'http://localhost:5000/api';
    const token = localStorage.getItem('token');

    // Auth Check
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    // Load Courses for Dropdown
    function loadCourses() {
        $.ajax({
            url: `${API_BASE}/courses`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
            success: function(response) {
                if (response.success) {
                    const courses = response.data;
                    const $select = $('#assignment-course');
                    $select.empty().append('<option value="">Select Course</option>');
                    courses.forEach(course => {
                        $select.append(`<option value="${course._id}">${course.title}</option>`);
                    });
                }
            },
            error: function(err) {
                console.error('Failed to load courses', err);
            }
        });
    }

    // Load Assignments for Table
    function loadAssignments() {
        // Since there is no "get all assignments" for admin in global scope usually, we might need to iterate courses or use a specific endpoint. 
        // For now, let's assume valid endpoint or we list by course. 
        // Actually, let's check routes. There IS 'GET /:courseId' to get assignments for a course. 
        // Admin dashboard usually views all. If no global endpoint, we might have to fetch courses first then their assignments.
        // Let's assume we want to show ALL assignments. We might need to loop through courses if the backend doesn't support "get all".
        // Checking backend route findings... 'GET /:courseId' was seen. 
        // Let's use a workaround: Fetch courses, then fetch assignments for each. 

        $('#assignments-list').html('<tr><td colspan="6" class="text-center">Loading...</td></tr>');

        $.ajax({
            url: `${API_BASE}/courses`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
            success: function(response) {
                if (response.success) {
                    const courses = response.data;
                    fetchAllAssignments(courses);
                }
            },
            error: function(err) {
                 $('#assignments-list').html('<tr><td colspan="6" class="text-center text-danger">Failed to load assignments.</td></tr>');
            }
        });
    }

    function fetchAllAssignments(courses) {
        let allAssignments = [];
        let promises = courses.map(course => {
            return $.ajax({
                url: `${API_BASE}/assignments/${course._id}`,
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(res => {
                if(res.success) {
                    return res.assignments.map(a => ({...a, courseTitle: course.title}));
                }
                return [];
            }).catch(err => []);
        });

        Promise.all(promises).then(results => {
            allAssignments = results.flat();
            renderAssignments(allAssignments);
        });
    }

    function renderAssignments(assignments) {
        const $tbody = $('#assignments-list');
        $tbody.empty();

        if (assignments.length === 0) {
            $tbody.html('<tr><td colspan="6" class="text-center">No assignments found.</td></tr>');
            return;
        }

        assignments.forEach(assignment => {
            const isAI = assignment.generatedByAI ? '<span class="ai-badge">AI Generated</span>' : '';
            const dueDate = moment(assignment.dueDate).format('MMM D, YYYY h:mm A');
            const type = assignment.type.charAt(0).toUpperCase() + assignment.type.slice(1);
            
            const html = `
                <tr>
                    <td>
                        <div class="fw-bold text-dark">${assignment.title}</div>
                        ${isAI}
                    </td>
                    <td>${assignment.courseTitle || 'Unknown Course'}</td>
                    <td>${dueDate}</td>
                    <td>${assignment.questions.length} Questions</td>
                    <td>${type}</td>
                    <td>
                        <div class="d-flex gap-2">
                             <button class="btn btn-sm btn-outline-danger btn-delete" data-id="${assignment._id}">Delete</button>
                        </div>
                    </td>
                </tr>
            `;
            $tbody.append(html);
        });
        
        // Bind Delete
        $('.btn-delete').click(function() {
             const id = $(this).data('id');
             if(confirm('Are you sure you want to delete this assignment?')) {
                 deleteAssignment(id);
             }
        });
    }
    
    function deleteAssignment(id) {
        $.ajax({
            url: `${API_BASE}/assignments/${id}`,
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
            success: function(res) {
                if(res.success) {
                    loadAssignments(); // Reload
                } else {
                    alert('Failed to delete');
                }
            },
            error: function() { alert('Error deleting assignment'); }
        });
    }

    // Handle Create Form
    $('#add-assignment-form').on('submit', function(e) {
        e.preventDefault();
        
        const courseId = $('#assignment-course').val();
        const title = $('#assignment-title').val();
        const dueDate = $('#assignment-duedate').val();
        const numQuestions = $('#num-questions').val();
        const method = $('input[name="gen-method"]:checked').val();
        
        if (!courseId || !title || !dueDate) {
            alert('Please fill all required fields');
            return;
        }
        
        const $btn = $('#btn-create-assignment');
        const $spinner = $btn.find('.spinner-border');
        
        $btn.prop('disabled', true);
        $spinner.removeClass('d-none');
        $btn.contents().last()[0].textContent = ' Processing...';

        if (method === 'custom') {
            const topic = $('#custom-topic').val();
            
            $.ajax({
                url: `${API_BASE}/assignments/generate/custom/${courseId}`,
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                contentType: 'application/json',
                data: JSON.stringify({
                    title,
                    topic,
                    dueDate,
                    numQuestions
                }),
                success: function(res) {
                    handleSuccess(res);
                },
                error: function(err) {
                    handleError(err);
                }
            });
        } else {
            // From Notes (Multipart)
            const fileInput = document.getElementById('notes-file');
            if (fileInput.files.length === 0) {
                 alert('Please upload a PDF file for notes.');
                 resetBtn();
                 return;
            }
            
            const formData = new FormData();
            formData.append('notes', fileInput.files[0]);
            formData.append('title', title);
            formData.append('dueDate', dueDate);
            formData.append('numQuestions', numQuestions);
            
            $.ajax({
                url: `${API_BASE}/assignments/generate/from-notes/${courseId}`,
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                processData: false, 
                contentType: false,
                data: formData,
                success: function(res) {
                    handleSuccess(res);
                },
                error: function(err) {
                    handleError(err);
                }
            });
        }
        
        function handleSuccess(res) {
            resetBtn();
            if (res.success) {
                $('#addAssignmentModal').modal('hide');
                $('#add-assignment-form')[0].reset();
                alert('Assignment Created Successfully!');
                loadAssignments();
            } else {
                alert('Failed: ' + res.message);
            }
        }
        
        function handleError(err) {
            resetBtn();
            console.error(err);
             alert('Error: ' + (err.responseJSON ? err.responseJSON.message : 'Server Error'));
        }
        
        function resetBtn() {
            $btn.prop('disabled', false);
            $spinner.addClass('d-none');
            $btn.contents().last()[0].textContent = ' Generate & Create';
        }
    });

    // Init
    loadCourses();
    loadAssignments();
});
