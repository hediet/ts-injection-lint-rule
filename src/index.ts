interface ServiceId<TService> {
    readonly T: TService;
    readonly id: string;
    (target: any, propertyKey: string, parameterIndex: number): void;
}

function describeService<TService>(id: string): ServiceId<TService> {
    const fn = (...args: any[]) => {
        console.log(args);
    };
    fn.id = id;
    fn.T = null as any;
    return fn;
}

const $LoginService = describeService<LoginService>("LoginService");
const $BlaService = describeService<{}>("BlaService");

class LoginService {
    public login(username: string, password: string): void {
        console.log("login");
    }

    public logout(): void {
        console.log("logout");
    }
}

class LoginViewModel {
    constructor(@$LoginService loginService: typeof $BlaService.T) {}

    public login(): void {}

    public logout(): void {}
}
