$(document).ready(function() {
    const API_BASE = 'http://localhost:5000/api';
    const token = localStorage.getItem('token');

    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    let allAssignments = [];
    let allSubmissions = [];

    // Initial Load
    loadData();

    function loadData() {
        // Parallel Fetch: Courses, Submissions
        // We assume GET /courses returns courses user is enrolled in (or all public). 
        // We'll then fetch assignments for those courses.
        
        Promise.all([
            $.ajax({ url: `${API_BASE}/courses`, method: 'GET', headers: { 'Authorization': `Bearer ${token}` } }),
            $.ajax({ url: `${API_BASE}/assignments/submissions/student`, method: 'GET', headers: { 'Authorization': `Bearer ${token}` } })
        ]).then(([coursesRes, submissionsRes]) => {
            const courses = coursesRes.data || [];
            allSubmissions = submissionsRes || []; // API returns direct array often, verify structure
            
            // Adjust if submissionsRes has structure { success: true, data: [] }
            if (submissionsRes.success && submissionsRes.data) allSubmissions = submissionsRes.data;

            // Fetch Assignments for each course
            const assignmentPromises = courses.map(course => 
                $.ajax({ 
                    url: `${API_BASE}/assignments/${course._id}`, 
                    method: 'GET', 
                    headers: { 'Authorization': `Bearer ${token}` } 
                }).then(res => res.success ? res.assignments.map(a => ({...a, courseTitle: course.title})) : [])
                  .catch(() => [])
            );

            return Promise.all(assignmentPromises);

        }).then(assignmentGroups => {
            allAssignments = assignmentGroups.flat();
            renderAssignments();
        }).catch(err => {
            console.error('Error loading data', err);
            $('#assignments-container').html('<p class="text-center text-danger">Failed to load assignments.</p>');
        });
    }

    // Filter Listeners
    $('input[name="status"]').change(renderAssignments);

    function renderAssignments() {
        const filter = $('input[name="status"]:checked').val(); // all, pending, submitted
        const container = $('#assignments-container');
        container.empty();

        const filtered = allAssignments.filter(assignment => {
            const sub = allSubmissions.find(s => s.assignmentId === assignment._id || s.assignmentId._id === assignment._id); // Check population
            assignment.submission = sub; // Attach for easy access
            
            if (filter === 'pending') return !sub;
            if (filter === 'submitted') return !!sub;
            return true;
        });

        if (filtered.length === 0) {
            container.html('<div class="text-center py-5 text-muted">No assignments found for this filter.</div>');
            return;
        }

        filtered.forEach(assignment => {
            const isSubmitted = !!assignment.submission;
            const statusClass = isSubmitted ? 'submitted' : (new Date(assignment.dueDate) < new Date() ? 'overdue' : 'pending');
            const statusText = isSubmitted ? 'Submitted' : (new Date(assignment.dueDate) < new Date() ? 'Overdue' : 'Pending');
            const badgeClass = isSubmitted ? 'bg-success' : (statusText === 'Overdue' ? 'bg-danger' : 'bg-warning text-dark');
            
            const dueDate = moment(assignment.dueDate).format('MMM D, YYYY h:mm A');
            
            const html = `
                <div class="assignment-card ${statusClass}">
                    <span class="status-badge ${badgeClass}">${statusText}</span>
                    <h5 class="fw-bold text-dark mb-1">${assignment.title}</h5>
                    <p class="text-muted small mb-2"><i class="fas fa-book me-1"></i> ${assignment.courseTitle}</p>
                    
                    <div class="d-flex align-items-center gap-3 text-secondary small mb-3">
                        <span><i class="far fa-clock me-1"></i> Due: ${dueDate}</span>
                        <span><i class="fas fa-question-circle me-1"></i> ${assignment.questions.length} Questions</span>
                    </div>

                    <button class="btn btn-outline-primary btn-sm btn-view w-100" data-id="${assignment._id}">
                        ${isSubmitted ? 'View Results' : 'View & Submit'}
                    </button>
                    
                     ${isSubmitted && assignment.submission.evaluation ? 
                        `<div class="progress-micro" title="Score: ${assignment.submission.evaluation.score}%">
                            <div class="bar" style="width: ${assignment.submission.evaluation.score}%"></div>
                         </div>` : ''}
                </div>
            `;
            container.append(html);
        });

        // Bind Events
        $('.btn-view').click(function() {
            const id = $(this).data('id');
            const assignment = allAssignments.find(a => a._id === id);
            openModal(assignment);
        });
    }

    function openModal(assignment) {
        const modal = $('#assignmentModal');
        const isSubmitted = !!assignment.submission;
        
        // Populate Details
        $('#modal-title').text(assignment.title);
        
        let detailsHtml = `
            <div class="mb-3">
                <p class="text-muted mb-1"><strong>Course:</strong> ${assignment.courseTitle}</p>
                <p class="text-muted mb-1"><strong>Due:</strong> ${moment(assignment.dueDate).format('LLLL')}</p>
                <p class="mb-3">${assignment.description || 'No description provided.'}</p>
                
                ${assignment.assignmentPdfPath ? 
                    `<a href="http://localhost:5000/${assignment.assignmentPdfPath}" target="_blank" class="btn btn-sm btn-info text-white">
                        <i class="fas fa-download me-1"></i> Download Assignment PDF
                     </a>` : ''
                }
            </div>
            <h6 class="fw-bold">Questions Preview:</h6>
            <ul class="list-group list-group-flush small">
                ${assignment.questions.slice(0, 3).map((q, i) => `<li class="list-group-item bg-light">${i+1}. ${q.questionText.substring(0, 100)}...</li>`).join('')}
                ${assignment.questions.length > 3 ? `<li class="list-group-item text-center text-muted">...and ${assignment.questions.length - 3} more</li>` : ''}
            </ul>
        `;
        $('#modal-details').html(detailsHtml);

        // Submission / Result State
        if (isSubmitted) {
            $('#submission-section').addClass('d-none');
            $('#evaluation-section').removeClass('d-none');
            
            const sub = assignment.submission;
            if (sub.evaluation && sub.evaluation.evaluatedAt) {
                $('#eval-score').text(`${sub.evaluation.score || 0}/100`);
                
                let feedbackHtml = `<p class="text-muted">${sub.evaluation.feedback || 'No summary provided.'}</p>`;
                
                if (sub.evaluation.strengths && sub.evaluation.strengths.length > 0) {
                    feedbackHtml += `<h6 class="fw-bold mt-3 text-success">Strengths</h6>
                                     <ul class="mb-2 text-muted small">
                                        ${sub.evaluation.strengths.map(s => `<li>${s}</li>`).join('')}
                                     </ul>`;
                }
                
                if (sub.evaluation.weaknesses && sub.evaluation.weaknesses.length > 0) {
                    feedbackHtml += `<h6 class="fw-bold mt-3 text-danger">Areas for Improvement</h6>
                                     <ul class="mb-2 text-muted small">
                                        ${sub.evaluation.weaknesses.map(w => `<li>${w}</li>`).join('')}
                                     </ul>`;
                }
                
                if (sub.evaluation.remarks) {
                     feedbackHtml += `<h6 class="fw-bold mt-3">Overall Remarks</h6>
                                      <p class="text-muted small fst-italic">"${sub.evaluation.remarks}"</p>`;
                }

                $('#eval-feedback').html(feedbackHtml);
            } else {
                $('#eval-score').text('Pending');
                $('#eval-feedback').html(`
                    <div class="alert alert-info">
                        <i class="fas fa-spinner fa-spin me-2"></i> AI is evaluating your submission. 
                        Please check back in a few minutes.
                    </div>
                `);
            }
        } else {
            $('#submission-section').removeClass('d-none');
            $('#evaluation-section').addClass('d-none');
            $('#sub-assignment-id').val(assignment._id);
            $('#sub-error').addClass('d-none');
            $('#submission-form')[0].reset();
        }

        modal.modal('show');
    }

    // Handle Submission
    $('#submission-form').on('submit', function(e) {
        e.preventDefault();
        
        const assignmentId = $('#sub-assignment-id').val();
        const activeTab = $('#submitTabs .nav-link.active').attr('id'); // text-tab or file-tab
        
        const formData = new FormData();
        
        if (activeTab === 'text-tab') {
            const text = $('#answer-text').val();
            if (!text.trim()) { alert('Please enter an answer.'); return; }
            formData.append('textAnswer', text);
        } else {
            const file = document.getElementById('answer-file').files[0];
            if (!file) { alert('Please upload a PDF.'); return; }
            formData.append('pdf', file);
        }

        const $btn = $('#btn-submit');
        $btn.prop('disabled', true).find('.spinner-border').removeClass('d-none');

        $.ajax({
            url: `${API_BASE}/assignments/${assignmentId}/submit`,
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            data: formData,
            processData: false,
            contentType: false,
            success: function(res) {
                $btn.prop('disabled', false).find('.spinner-border').addClass('d-none');
                $('#assignmentModal').modal('hide');
                alert('Submission Recieved! AI is evaluating...');
                loadData(); // Reload to show submitted status
            },
            error: function(err) {
                $btn.prop('disabled', false).find('.spinner-border').addClass('d-none');
                $('#sub-error').removeClass('d-none').text(err.responseJSON?.message || 'Submission failed');
            }
        });
    });
});
