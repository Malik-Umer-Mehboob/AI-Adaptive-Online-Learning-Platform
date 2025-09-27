$(document).ready(function () {
    console.log('auth.js loaded');

    // Bootstrap Toast Alert Function
    function showAlert(message, type = 'danger') {
        if ($('#toastContainer').length === 0) {
            $('body').append(`
                <div id="toastContainer" class="position-fixed top-0 end-0 p-3" style="z-index: 1055;"></div>
            `);
        }

        const toastId = 'toast-' + new Date().getTime();
        const bgClass = {
            danger: 'bg-danger text-white',
            success: 'bg-success text-white',
            warning: 'bg-warning text-dark'
        }[type] || 'bg-danger text-white';

        const toastHtml = `
            <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true" data-bs-autohide="true" data-bs-delay="4000" style="min-width: 300px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2); transition: all 0.3s ease-in-out;">
                <div class="toast-body ${bgClass} d-flex align-items-center justify-content-between p-3" style="border-radius: 10px;">
                    <span>${message}</span>
                    <button type="button" class="btn-close btn-close-white ms-2" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
            </div>
        `;

        $('#toastContainer').append(toastHtml);
        const toastElement = $(`#${toastId}`);
        toastElement.css({ opacity: 0, transform: 'translateY(-20px)' });
        toastElement.animate({ opacity: 1, transform: 'translateY(0)' }, 300);
        toastElement.toast('show');
        toastElement.on('hidden.bs.toast', function () {
            $(this).animate({ opacity: 0, transform: 'translateY(-20px)' }, 300, function () {
                $(this).remove();
            });
        });
    }

    // Signup Form
    $('#signupForm').submit(function (e) {
        e.preventDefault();

        const formData = {
            name: $('input[name="name"]').val().trim(),
            email: $('input[name="email"]').val().trim(),
            password: $('input[name="password"]').val().trim(),
            confirmPassword: $('input[name="confirmPassword"]').val().trim(),
            role: $('select[name="role"]').val(),
        };

        console.log('Signup Form Data:', formData);

        if (!formData.name || !formData.email || !formData.password || !formData.confirmPassword) {
            showAlert('Fill in all required fields.', 'warning');
            return;
        }

        if (formData.password !== formData.confirmPassword) {
            showAlert('Passwords do not match.', 'danger');
            return;
        }

        $.ajax({
            url: 'http://localhost:5000/api/auth/signup',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(formData),
            success: function (response) {
                console.log('Signup Success:', response);
                showAlert(response.message, 'success');
                setTimeout(() => {
                    window.location.href = '/html/template/login.html';
                }, 1500);
            },
            error: function (xhr) {
                console.error('Signup Error:', xhr.responseJSON);
                showAlert(xhr.responseJSON?.message || 'Error during signup.', 'danger');
            },
        });
    });

    // Signin Form
    $('#signinForm').submit(function (e) {
        e.preventDefault();

        const formData = {
            email: $('input[name="email"]').val().trim(),
            password: $('input[name="password"]').val().trim(),
        };

        console.log('Signin Form Data:', formData);

        if (!formData.email || !formData.password) {
            showAlert('Fill in all required fields.', 'warning');
            return;
        }

        $.ajax({
            url: 'http://localhost:5000/api/auth/signin',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(formData),
            success: function (response) {
                console.log('Signin Response:', JSON.stringify(response, null, 2)); // Detailed debug
                if (!response.token || !response.role || !response.redirectUrl) {
                    console.error('Incomplete signin response:', response);
                    showAlert('Incomplete response from server. Missing token, role, or redirectUrl.', 'danger');
                    return;
                }
                localStorage.setItem('token', response.token);
                showAlert(`Signin successful. Redirecting to ${response.role} dashboard...`, 'success');
                setTimeout(() => {
                    window.location.href = response.redirectUrl;
                }, 1500);
            },
            error: function (xhr) {
                console.error('Signin Error:', JSON.stringify(xhr.responseJSON, null, 2));
                showAlert(xhr.responseJSON?.message || 'Error during signin.', 'danger');
            },
        });
    });

    // Forgot Password Form
    $('#forgotPasswordForm').submit(function (e) {
        e.preventDefault();

        const formData = {
            email: $('input[name="email"]').val().trim(),
        };

        console.log('Forgot Password Form Data:', formData);

        if (!formData.email) {
            showAlert('Fill in the email field.', 'warning');
            return;
        }

        $.ajax({
            url: 'http://localhost:5000/api/auth/forgot-password',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(formData),
            success: function (response) {
                console.log('Forgot Password Success:', response);
                showAlert(response.message, 'success');
                setTimeout(() => {
                    window.location.href = `/html/template/set-password.html?token=${response.resetToken}&email=${encodeURIComponent(formData.email)}`;
                }, 1500);
            },
            error: function (xhr) {
                console.error('Forgot Password Error:', xhr.responseJSON);
                showAlert(xhr.responseJSON?.message || 'Error in forgot password process.', 'danger');
            },
        });
    });

    // Set Password Form
    $('#setPasswordForm').submit(function (e) {
        e.preventDefault();

        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        const email = urlParams.get('email');

        if (!token || !email) {
            console.error('Missing token or email:', { token, email });
            showAlert('Reset token or email not received. Please try the forgot password process again.', 'danger');
            return;
        }

        const formData = {
            token: token,
            email: email,
            password: $('input[name="password"]').val().trim(),
            confirmPassword: $('input[name="confirmPassword"]').val().trim(),
            otp: $('input[name="otp"]').val().trim(),
        };

        console.log('Set Password Form Data:', formData);

        if (!formData.password || !formData.confirmPassword || !formData.otp) {
            showAlert('Fill in all required fields, including OTP.', 'warning');
            return;
        }

        if (formData.password !== formData.confirmPassword) {
            showAlert('Passwords do not match.', 'danger');
            return;
        }

        $.ajax({
            url: 'http://localhost:5000/api/auth/reset-password',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(formData),
            success: function (response) {
                console.log('Reset Password Success:', response);
                if (!response.role || !response.redirectUrl) {
                    console.error('Incomplete reset password response:', response);
                    showAlert('Incomplete response from server. Please login again.', 'danger');
                    setTimeout(() => {
                        window.location.href = '/html/template/login.html';
                    }, 1500);
                    return;
                }
                showAlert(`Password reset successful. Redirecting to ${response.role} dashboard...`, 'success');
                setTimeout(() => {
                    window.location.href = response.redirectUrl;
                }, 1500);
            },
            error: function (xhr) {
                console.error('Reset Password Error:', xhr.responseJSON);
                showAlert(xhr.responseJSON?.message || 'Error during password reset.', 'danger');
            },
        });
    });
});