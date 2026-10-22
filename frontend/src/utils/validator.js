export const isEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
};

export const isPhone = (phone) => {
    const re = /^[0-9]{10,11}$/;
    return re.test(String(phone));
};

export const isNotEmpty = (val) => val && val.trim().length > 0;
